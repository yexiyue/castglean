//! Isolated research generator; not linked into the application.
use std::{error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let input = PathBuf::from(args.next().ok_or("missing schema path")?);
    let output = PathBuf::from(args.next().ok_or("missing output path")?);
    let schema: schemars::schema::RootSchema = serde_json::from_slice(&fs::read(input)?)?;
    let mut types = typify::TypeSpace::default();
    types.add_root_schema(schema)?;
    let generated = prettyplease::unparse(&syn::parse2::<syn::File>(types.to_stream()?)?);
    fs::write(output, generated)?;
    Ok(())
}
