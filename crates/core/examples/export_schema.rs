//! Explicit export of schemas to the directory given by the caller.

use castglean_core::{annotations_schema, characters_schema, write_json};
use std::{
    fs::{self, File},
    path::PathBuf,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: export_schema <directory>")?;
    fs::create_dir_all(&directory)?;
    write_json(
        File::create(directory.join("characters.schema.json"))?,
        &characters_schema(),
    )?;
    write_json(
        File::create(directory.join("annotations.schema.json"))?,
        &annotations_schema(),
    )?;
    Ok(())
}
