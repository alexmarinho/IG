pub mod eval;
pub mod instance;
pub mod ops;
pub mod race;
pub mod rng;
pub mod solver;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use eval::State;
pub use instance::Instance;
pub use rng::Rng;
#[cfg(not(target_arch = "wasm32"))]
pub use solver::solve;
pub use solver::{Accept, Outcome, Params, Run};
