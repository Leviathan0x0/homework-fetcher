use std::process::ExitCode;

use anyhow::Result;
use mmss_backend::{app, config::Config, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            // The cause, not the phase. An import that failed because a roster row was
            // malformed has not failed to *start*, and saying so sends an operator looking
            // at the wrong thing.
            tracing::error!(%error, "mmss-backend exited with an error");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<()> {
    // `import` and `accounts` are operator actions on a deployment, not requests. They
    // run against the configured database and exit; neither ever opens the listener, so
    // there is no window in which an HTTP caller could create or deactivate an account.
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("import") => return mmss_backend::provisioning::run_cli(&args[1..]).await,
        Some("accounts") => return mmss_backend::lifecycle_cli::run_cli(&args[1..]).await,
        _ => {}
    }

    let config = Config::from_env()?;
    tracing::info!(host = %config.host, port = config.port, "starting mmss-backend");

    let state = AppState::new(config).await?;
    // An empty database has no accounts, so the configured administrator is created
    // before the listener opens. No-op when ADMIN_PASSWORD is unset.
    mmss_backend::bootstrap::ensure_admin(&state.db, &state.config).await?;

    let listener = tokio::net::TcpListener::bind(state.config.addr()).await?;
    tracing::info!(address = %listener.local_addr()?, "listening");

    let result = axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await;

    tracing::info!("database pool closed");
    result?;
    tracing::info!("shutdown complete");
    Ok(())
}

/// Resolves when the process is asked to stop.
///
/// A failure to *install* a handler is logged rather than panicked. This runs after the
/// listener is already up, so an `expect` here would turn a degraded signal handler into a
/// dead process -- and on a SIGTERM-less container it would take the app down on a signal it
/// was merely unable to observe.
async fn shutdown_signal() {
    let ctrl_c = async {
        match tokio::signal::ctrl_c().await {
            Ok(()) => tracing::info!("received Ctrl+C, shutting down"),
            Err(error) => tracing::warn!(%error, "Ctrl+C handler failed"),
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
                tracing::info!("received SIGTERM, shutting down");
            }
            Err(error) => tracing::warn!(%error, "SIGTERM handler failed"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    // Both branches fall through to here, so a handler that failed leaves this future
    // resolved immediately and `axum::serve` starts draining. That is the safe direction:
    // better a fast shutdown than an unstoppable process.
    tracing::info!("shutdown signal observed");
}
