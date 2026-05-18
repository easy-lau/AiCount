use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use chrono::{Local, Timelike};

use crate::code_stats;

const TRAY_ID: &str = "aicount-main-tray";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID);
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    let _tray = builder
        .tooltip("AICount")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    match window.is_visible() {
                        Ok(true) => {
                            let _ = window.hide();
                        }
                        _ => {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn today_start_ms() -> i64 {
    let now = Local::now();
    let start = now
        .with_hour(0)
        .and_then(|d| d.with_minute(0))
        .and_then(|d| d.with_second(0))
        .and_then(|d| d.with_nanosecond(0))
        .unwrap_or(now);
    start.timestamp_millis()
}

pub fn compute_today_loc() -> u64 {
    let from_ms = today_start_ms();
    let to_ms = chrono::Utc::now().timestamp_millis();
    let overview = code_stats::compute_overview(None, from_ms, to_ms);
    overview.total_loc
}

pub fn update_tooltip(app: &AppHandle) {
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let loc = compute_today_loc();
        if let Some(tray) = app_clone.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(format!("AICount · 今日 +{} 行", loc)));
        }
    });
}
