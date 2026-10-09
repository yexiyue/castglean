//! Explicit export of schemas to the directory given by the caller.

use castglean_core::{
    analysis_failure_schema, annotations_schema, book_schema, characters_schema,
    corrections_schema, run_plan_schema, write_json,
};
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
        File::create(directory.join("analysis-failure.schema.json"))?,
        &analysis_failure_schema(),
    )?;
    write_json(
        File::create(directory.join("run-plan.schema.json"))?,
        &run_plan_schema(),
    )?;
    write_json(
        File::create(directory.join("characters.schema.json"))?,
        &characters_schema(),
    )?;
    write_json(
        File::create(directory.join("annotations.schema.json"))?,
        &annotations_schema(),
    )?;
    write_json(
        File::create(directory.join("book.schema.json"))?,
        &book_schema(),
    )?;
    write_json(
        File::create(directory.join("corrections.schema.json"))?,
        &corrections_schema(),
    )?;
    Ok(())
}
