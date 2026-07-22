//! MaScLib (ILOG MASC 1.0 CSV) instance model and parser.

use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Job {
    pub id: usize,
    /// setup family (SETUP_STATE); 0 when the instance has no setups
    pub fam: usize,
    pub p: i64,        // PROCESSING_TIME
    pub rel: i64,      // START_MIN (release date)
    pub due: i64,      // DUE_TIME
    pub w: i64,        // TARDINESS_VARIABLE_COST (deci-units, ×10)
    pub e: i64,        // EARLINESS_VARIABLE_COST (deci-units; MaScLib is a just-in-time objective)
    pub mode_cost: i64,
    pub rej: i64,      // UNPERFORMED_COST
    pub end_max: i64,  // hard deadline for completion
}

#[derive(Debug, Clone)]
pub struct Instance {
    pub name: String,
    pub jobs: Vec<Job>,
    pub n_states: usize,
    pub init_state: usize,
    /// flattened [from * n_states + to]
    pub(crate) setup_t: Vec<i64>,
    pub(crate) setup_c: Vec<i64>,
}

impl Instance {
    #[inline(always)]
    pub fn setup_t(&self, from: usize, to: usize) -> i64 {
        self.setup_t[from * self.n_states + to]
    }
    #[inline(always)]
    pub fn setup_c(&self, from: usize, to: usize) -> i64 {
        self.setup_c[from * self.n_states + to]
    }
    pub fn n(&self) -> usize {
        self.jobs.len()
    }

    pub fn parse(path: &Path) -> Result<Instance, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{path:?}: {e}"))?;
        Self::parse_str(&text)
    }

    pub fn parse_str(text: &str) -> Result<Instance, String> {
        let mut name = String::new();
        let mut headers: HashMap<String, Vec<String>> = HashMap::new();
        let mut init_state: Option<usize> = None;
    let mut n_resources: usize = 0;
        // per-activity fields gathered from the ACTIVITY / DUE_DATE / MODE sections
        let mut fams: HashMap<usize, usize> = HashMap::new();
        let mut dues: HashMap<usize, (i64, i64, i64)> = HashMap::new(); // (due, w, e)
        let mut modes: HashMap<usize, (i64, i64, i64, i64, i64)> = HashMap::new(); // (mode_cost, p, rel, end_max, rej)
        let mut setups: Vec<(usize, usize, i64, i64)> = Vec::new();

        let col = |headers: &HashMap<String, Vec<String>>, sec: &str, name: &str| -> Option<usize> {
            headers.get(sec).and_then(|h| h.iter().position(|c| c == name))
        };

        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let cells: Vec<&str> = line.split(',').collect();
            let tag = cells[0];
            if let Some((sec, kind)) = tag.split_once('|') {
                if kind == "NAMES" {
                    headers.insert(sec.to_string(), cells[1..].iter().map(|s| s.to_string()).collect());
                }
                continue;
            }
            let get = |cname: &str| -> Option<&str> {
                col(&headers, tag, cname).and_then(|i| cells.get(i + 1).copied())
            };
            let geti = |cname: &str| -> Option<i64> { get(cname).and_then(|v| v.trim().parse().ok()) };
            // money/weight fields are stored in deci-units (×10): the data has
            // fractional E/T weights with 0.1 granularity
            let getd = |cname: &str| -> Option<i64> {
                get(cname)
                    .and_then(|v| v.trim().parse::<f64>().ok())
                    .map(|v| (v * 10.0).round() as i64)
            };
            match tag {
                "MODEL" => {
                    if let Some(v) = get("NAME") {
                        name = v.to_string();
                    }
                }
                "RESOURCE" => {
                    n_resources += 1;
                    if n_resources > 1 {
                        return Err("multi-resource (multi-machine) instances are not supported yet; \
                                    this parser would silently collapse them to a wrong single-machine \
                                    instance (see docs/research/multi-machine-benchmark-decision.md)"
                            .into());
                    }
                    init_state = geti("INITIAL_SETUP_STATE").map(|v| v as usize);
                }
                "ACTIVITY" => {
                    let id = geti("ACTIVITY_ID").ok_or("ACTIVITY without id")? as usize;
                    fams.insert(id, geti("SETUP_STATE").unwrap_or(0) as usize);
                }
                "SETUP_MATRIX" => {
                    let f = geti("FROM_STATE").ok_or("bad SETUP_MATRIX")? as usize;
                    let t = geti("TO_STATE").ok_or("bad SETUP_MATRIX")? as usize;
                    setups.push((f, t, geti("SETUP_TIME").unwrap_or(0), getd("SETUP_COST").unwrap_or(0)));
                }
                "DUE_DATE" => {
                    let id = geti("ACTIVITY_ID").ok_or("bad DUE_DATE")? as usize;
                    dues.insert(
                        id,
                        (
                            geti("DUE_TIME").unwrap_or(0),
                            getd("TARDINESS_VARIABLE_COST").unwrap_or(0),
                            getd("EARLINESS_VARIABLE_COST").unwrap_or(0),
                        ),
                    );
                }
                "MODE" => {
                    let id = geti("ACTIVITY_ID").ok_or("bad MODE")? as usize;
                    if modes.contains_key(&id) {
                        return Err("multiple MODE rows for one activity (machine-choice instances) \
                                    are not supported yet; the last row would silently win"
                            .into());
                    }
                    modes.insert(
                        id,
                        (
                            getd("MODE_COST").unwrap_or(0),
                            geti("PROCESSING_TIME").unwrap_or(0),
                            geti("START_MIN").unwrap_or(0),
                            geti("END_MAX").unwrap_or(i64::MAX / 4),
                            getd("UNPERFORMED_COST").unwrap_or(0),
                        ),
                    );
                }
                _ => {}
            }
        }

        let n_states = setups
            .iter()
            .map(|&(f, t, _, _)| f.max(t) + 1)
            .max()
            .unwrap_or(1)
            .max(init_state.map_or(0, |s| s + 1));
        let mut setup_t = vec![0i64; n_states * n_states];
        let mut setup_c = vec![0i64; n_states * n_states];
        for (f, t, st, sc) in setups {
            setup_t[f * n_states + t] = st;
            setup_c[f * n_states + t] = sc;
        }

        let mut ids: Vec<usize> = modes.keys().copied().collect();
        ids.sort_unstable();
        let jobs = ids
            .iter()
            .map(|&id| {
                let (mode_cost, p, rel, end_max, rej) = modes[&id];
                let (due, w, e) = *dues.get(&id).unwrap_or(&(end_max, 0, 0));
                Job {
                    id,
                    fam: *fams.get(&id).unwrap_or(&0),
                    p,
                    rel,
                    due,
                    w,
                    e,
                    mode_cost,
                    rej,
                    end_max,
                }
            })
            .collect();

        Ok(Instance {
            name,
            jobs,
            n_states,
            init_state: init_state.unwrap_or(0),
            setup_t,
            setup_c,
        })
    }
}
