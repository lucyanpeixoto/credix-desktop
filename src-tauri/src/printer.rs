//! Envio de bytes crus (ESC/POS) para impressoras térmicas.
//!
//! - Rede: conexão TCP direta na porta 9100 (padrão das térmicas com Ethernet).
//! - Sistema: a impressora instalada no Windows (spooler em modo RAW) ou no
//!   macOS/Linux (CUPS, `lp -o raw`). É o caminho das impressoras USB.

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

pub fn network(host: &str, port: u16, data: &[u8]) -> Result<(), String> {
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Endereço da impressora inválido ({host}:{port}): {e}"))?
        .next()
        .ok_or_else(|| format!("Impressora {host}:{port} não encontrada."))?;

    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(4))
        .map_err(|e| format!("Não conectou na impressora {host}:{port}: {e}"))?;
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
    stream
        .write_all(data)
        .and_then(|_| stream.flush())
        .map_err(|e| format!("Falha ao enviar para a impressora: {e}"))
}

#[cfg(not(windows))]
pub fn system(printer: &str, data: &[u8]) -> Result<(), String> {
    use std::process::{Command, Stdio};

    let mut child = Command::new("lp")
        .args(["-d", printer, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não foi possível chamar o lp: {e}"))?;

    child
        .stdin
        .take()
        .ok_or("Sem acesso à entrada do lp.")?
        .write_all(data)
        .map_err(|e| format!("Falha ao enviar para a impressora: {e}"))?;

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "A impressora \"{printer}\" recusou o trabalho: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

#[cfg(not(windows))]
pub fn list() -> Result<Vec<String>, String> {
    use std::process::Command;

    // `lpstat -e` lista só os nomes; sem CUPS volta vazio.
    let out = match Command::new("lpstat").arg("-e").output() {
        Ok(o) => o,
        Err(_) => return Ok(vec![]),
    };
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect())
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn system(printer: &str, data: &[u8]) -> Result<(), String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW, StartPagePrinter,
        WritePrinter, DOC_INFO_1W,
    };

    let name = wide(printer);
    let mut doc_name = wide("Credix PDV");
    let mut datatype = wide("RAW");

    unsafe {
        let mut handle: HANDLE = null_mut();
        if OpenPrinterW(name.as_ptr(), &mut handle, null()) == 0 {
            return Err(format!("Impressora \"{printer}\" não encontrada no Windows."));
        }

        let doc = DOC_INFO_1W {
            pDocName: doc_name.as_mut_ptr(),
            pOutputFile: null_mut(),
            pDatatype: datatype.as_mut_ptr(),
        };

        let result = (|| {
            if StartDocPrinterW(handle, 1, &doc) == 0 {
                return Err("O Windows não aceitou o trabalho de impressão.".to_string());
            }
            if StartPagePrinter(handle) == 0 {
                EndDocPrinter(handle);
                return Err("O Windows não abriu a página de impressão.".to_string());
            }
            let mut written: u32 = 0;
            let ok = WritePrinter(handle, data.as_ptr() as *const _, data.len() as u32, &mut written);
            EndPagePrinter(handle);
            EndDocPrinter(handle);
            if ok == 0 || written as usize != data.len() {
                return Err("Falha ao enviar para a impressora.".to_string());
            }
            Ok(())
        })();

        ClosePrinter(handle);
        result
    }
}

#[cfg(windows)]
pub fn list() -> Result<Vec<String>, String> {
    use std::ptr::null;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };

    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut count: u32 = 0;

    unsafe {
        // 1ª chamada: descobre o tamanho do buffer.
        EnumPrintersW(flags, null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut count);
        if needed == 0 {
            return Ok(vec![]);
        }
        let mut buf = vec![0u8; needed as usize];
        if EnumPrintersW(flags, null(), 4, buf.as_mut_ptr(), needed, &mut needed, &mut count) == 0 {
            return Err("Não foi possível listar as impressoras do Windows.".into());
        }

        let infos = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, count as usize);
        Ok(infos
            .iter()
            .filter(|i| !i.pPrinterName.is_null())
            .map(|i| {
                let mut len = 0;
                while *i.pPrinterName.add(len) != 0 {
                    len += 1;
                }
                String::from_utf16_lossy(std::slice::from_raw_parts(i.pPrinterName, len))
            })
            .collect())
    }
}
