//! Archive a version-rejected database before the normal startup creates a fresh one.
use super::DATABASE_FILE;
use apalis_sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

/// The caller holds the data directory's runtime lock throughout the operation.
pub(crate) async fn archive_incompatible(
    root: &Path,
    expected_version: i64,
) -> anyhow::Result<PathBuf> {
    let path = root.join(DATABASE_FILE);
    anyhow::ensure!(
        fs::symlink_metadata(&path)?.is_file(),
        "database path is not a regular file"
    );

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(false)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await?;
    let db = DatabaseConnection::from(pool);
    let prepare = prepare_archive(&db, expected_version).await;
    db.close().await?;
    prepare?;

    // SQLite must finish removing its sidecars before the next startup can
    // create a fresh database at the original name.
    for suffix in ["-wal", "-shm", "-journal"] {
        let name = format!("{DATABASE_FILE}{suffix}");
        match fs::symlink_metadata(root.join(&name)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
            Ok(_) => anyhow::bail!("SQLite sidecar still present: {name}"),
        }
    }

    let backups = root.join("database-backups");
    fs::create_dir_all(&backups)?;
    anyhow::ensure!(
        fs::symlink_metadata(&backups)?.is_dir(),
        "database backup path is not a directory"
    );
    let backup = tempfile::Builder::new()
        .prefix(&format!("schema-v{expected_version}-"))
        .tempdir_in(backups)?;
    fs::rename(path, backup.path().join(DATABASE_FILE))?;
    Ok(backup.keep().join(DATABASE_FILE))
}

async fn prepare_archive(db: &DatabaseConnection, expected_version: i64) -> anyhow::Result<()> {
    let query = |sql| Statement::from_string(DbBackend::Sqlite, sql);
    let version: i64 = db
        .query_one_raw(query("PRAGMA user_version"))
        .await?
        .ok_or_else(|| anyhow::anyhow!("missing database schema version"))?
        .try_get_by_index(0)?;
    anyhow::ensure!(
        version == expected_version,
        "database version changed while awaiting confirmation"
    );

    // Switching out of WAL checkpoints pending commits and requires exclusive
    // database access. A busy connection or a different returned mode fails closed.
    let mode: String = db
        .query_one_raw(query("PRAGMA journal_mode = DELETE"))
        .await?
        .ok_or_else(|| anyhow::anyhow!("missing database journal mode"))?
        .try_get_by_index(0)?;
    anyhow::ensure!(mode == "delete", "could not close the database journal");
    Ok(())
}
