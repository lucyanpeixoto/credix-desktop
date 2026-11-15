//! Lado nativo do Credix PDV: só o que o navegador não alcança — mandar bytes
//! ESC/POS para a impressora térmica (rede ou instalada no sistema) e abrir o
//! comprovante em meia folha A4 no navegador do computador.

mod printer;

#[tauri::command]
async fn print_network(host: String, port: u16, data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || printer::network(&host, port, &data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn print_system(printer: String, data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || printer::system(&printer, &data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_printers() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(printer::list)
        .await
        .map_err(|e| e.to_string())?
}

/// Abre um link do Credix no navegador padrão (comprovante em meia folha A4,
/// impresso pela janela de impressão do sistema). Só http(s).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Link inválido.".into());
    }
    #[cfg(target_os = "windows")]
    // rundll32 em vez de "cmd /c start": o & do link não passa pelo cmd.
    let result = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url.as_str()]).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    result.map(|_| ()).map_err(|e| format!("Não abriu o navegador: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            use tauri::Manager;
            // Caixa sempre ocupa a tela toda ao abrir. Mostra antes de maximizar:
            // maximizar a janela ainda escondida faz o show() voltar ao tamanho
            // normal (abria cheia e logo diminuía).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.maximize();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![print_network, print_system, list_printers, open_url])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Credix PDV");
}
