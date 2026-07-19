pub mod instance;
pub mod solver;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use instance::Instance;
#[cfg(not(target_arch = "wasm32"))]
pub use solver::solve;
pub use solver::{Accept, Outcome, Params, Run};
