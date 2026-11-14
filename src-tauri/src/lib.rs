//! Lado nativo do Credix PDV: só o que o navegador não alcança — mandar bytes
//! ESC/POS para a impressora térmica (rede ou instalada no sistema).

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![print_network, print_system, list_printers])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Credix PDV");
}
