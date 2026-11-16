# volute

A Java-first Heston calibration lab. Fit 15 invented European call prices from three fixed starts, inspect the five parameters, and check six clean prices that the search never sees.

A small calibration residual is not proof of true parameters, statistical identification, a global minimum or future hedging quality. No market quotes, accounts, orders, Greeks, hedging PnL or investment forecasts.

## Complete v1

- Original complex-arithmetic Heston pricer, using the decaying-exponential characteristic-function formulation and Lewis inversion.
- Composite 16-node Gauss-Legendre pricing through frequency 1024, with a 32-node, cutoff-2048 refinement diagnostic on every final quote.
- Three deterministic bounded Nelder-Mead searches. Full best-so-far loss traces, iteration/evaluation counts, boundary diagnostics and actual stop reason.
- Every initial and final parameter set, selected price curve, target dots, quote/residual audit, and complete 21-quote ledger.
- Local numerical worker keeps the page responsive. No runtime network, storage, accounts or backend.

## Experiment, not market calibration

Invented spot S = 100 price units; continuously compounded rate r = 0.02 and dividend yield q = 0.01, fixed. Calls have European exercise. Fit strikes 80, 90, 100, 110, 120 at maturities 0.25, 1 and 2 years. No real currency or underlying security is implied.

Three named parameter presets generate clean prices. A seeded bounded-uniform multiplier perturbs each of the 15 calibration prices by at most the chosen relative noise. Default 20 basis points means ±0.20% of the clean price, not 20 volatility points or a bid-ask spread. It is not a microstructure model. These noisy targets are not repaired to enforce static arbitrage.

The objective is the equally weighted mean squared price residual over those 15 targets, not implied-volatility, relative-error or vega-weighted loss. High-priced options can dominate. The six withheld clean quotes use strikes 85, 100, 115 at 0.5 and 1.5 years. Their prices do not enter any optimizer call. Their RMSE is a within-model interpolation diagnostic, not a time-series backtest or independent market validation. The same numerical engine generates and fits the fixture, making this easier than empirical calibration; independent tests check pricing separately.

## Model and bounds

```text
dS/S = (r-q) dt + sqrt(v) dW1
dv = kappa*(theta-v) dt + sigma*sqrt(v) dW2
corr(dW1,dW2) = rho
```

Here sigma is the volatility of variance, displayed as ξ to avoid confusion with spot volatility. v₀ and θ are annualized variances, not volatilities; their square roots are annualized volatility scales. Time is in years, κ is inverse years, ξ has inverse-year units under this time convention, and ρ is dimensionless. These are risk-neutral model parameters, not estimates of physical future returns.

| Parameter                | Pricing and search box |
| ------------------------ | ---------------------- |
| Initial variance v₀      | 0.02 to 0.09           |
| Reversion speed κ        | 0.6 to 3.5             |
| Long-run variance θ      | 0.02 to 0.09           |
| Volatility of variance ξ | 0.15 to 0.75           |
| Shock correlation ρ      | -0.85 to -0.15         |

Pricing accepts only strikes [80,120] and maturities [0.25,2]. These bounds are deliberate numerical scope, not a universal Heston library. ξ = 0, zero maturity, positive correlation, exotic exercise and extrapolation are not supported. The optimizer searches five linearly normalized coordinates in [0,1], projecting trial points to that box. Bounds can distort a simplex and trap a search; they are not confidence limits.

Three fixed starts, each with a +0.08 coordinate simplex step, share a 350-iteration cap. Stopping requires both normalized coordinate diameter < 2e-5 and objective spread < 1e-10. Otherwise the UI says budget cap. It selects the lowest final loss, without claiming a global optimum. Agreement among starts does not establish uniqueness. Parameter(s) within 1e-5 of a normalized boundary are counted explicitly. No synthetic truth or withheld target is passed into `fit`.

The signed Feller margin is `2*kappa*theta-sigma²`. A positive value meets a strict sufficient condition for inaccessible zero variance. A nonpositive value is not an instruction to reject a Fourier price; zero-attainability concerns are separate from whether a call is priced accurately. The search does not force Feller positivity and no variance paths are simulated.

## Run and verify

Java 21, Node 22, Python 3.12 in CI. No application dependencies. NumPy 2.2.6 and SciPy 1.15.3 are version-pinned test-only dependencies, not bundled code.

```sh
javac -d build/classes src/volute/*.java tools/*.java tests/volute/*.java
java -cp build/classes volute.TestRunner
node tests/parity.mjs
node tests/domain.mjs
python3 -m pip install numpy==2.2.6 scipy==1.15.3
python3 tests/reference.py
node tools/build-web.mjs
python3 -m http.server 8080 --directory docs
```

Serve over HTTP, not `file://`, because the local module worker needs a web origin. Open the printed local address. `node tests/browser-smoke.mjs` needs Google Chrome on PATH and free ports 8998/9399. It creates and cleans up its own local server and temporary browser profile. `SMOKE_SHOTS=1` captures local screenshots; `SMOKE_URL` points the same checks at deployment.

Java and JS cover parameter/call bounds, strike monotonicity/convexity, characteristic-function normalization/conjugacy/modulus, quadrature refinement, objective arithmetic, monotone best-loss traces, best-start selection, target isolation, invalid input and clean zero-noise recovery. Java/JS compare complete results, including every loss-trace value, at scaled 2e-9. These are not independent pricing implementations merely because the languages differ.

Independent Python uses native complex arithmetic and adaptive two-probability Fourier inversion through 2048, not the production Lewis integral or hand-built GL rule. Numerical Riccati ODE solutions check the closed-form characteristic function. A separate NumPy quadrature and SciPy bounded least-squares solver check the final calibration loss and local improvement from all nine fixture settings. This does not prove global optimizer correctness or numerical error bounds over a continuum. See [NUMERICS.md](NUMERICS.md).

## API and presentation

Java `Engine.run(Config)` and JS `run(config)` return full synthetic experiments. Config: integer surface 0..2, finite relative-noise bps 0..100, integer seed 1..9999. `surface(params)` returns the 15 clean calibration-grid prices. `fit(targets,start)` accepts exactly 15 finite prices in [0,100], copies them, and knows only the targets and fixed grid, not the generator. Start is integer 0..2. `price(params,T,K,fine)` prices one supported call. Public characteristic-function helper accepts real u in [-512,512], imaginary part [-0.5,0], T [0.25,2]. It omits the deterministic drift, as specified in NUMERICS.

Inputs are copied where retained. Java records hold scalar values, but result/trace arrays are mutable caller-owned snapshots. JS arrays and objects are also mutable snapshots, not deep immutable. The estimator has no shared mutable state. Private pricing grids/bounds/starts cannot be changed through a returned result.

The worker serializes submissions. While fitting, previous results remain visible, and edits do not start another run. Edits made during a run remain pending after its result applies. Invalid controls and invalid quote selection retain the previous result/quote. Resize and inspection never apply pending inputs. Main metrics use four decimals, audits six; nonzero magnitudes below 1e-6 use scientific notation. All calculations use unrounded values. Plotting alone applies a 1e-16 loss floor before log10. The main facts fit a phone column; only the supplemental ledger scrolls. Native Safari/Android untested.

The refinement gap compares finer panels and a longer cutoff on the selected fit, not an external truth price or rigorous error bound. Low gap does not establish accurate fitted parameters. No price clipping, variance floor, hidden arbitrage repair or silently substituted optimizer is used.

## Security, sources and license

Static self-contained assets, local module worker, no external fonts or dependencies at runtime. CSP denies network connections, inline code, objects, base changes and form submissions. CI actions/security versions are pinned; Python test packages use version-only pins. Private research, design, reviews, logs, screenshots and credentials are not public source.

Original implementation and design, no external code, paper, market dataset, font or image bundled. Background methods:

- [Cui, del Baño Rollin and Germano](https://arxiv.org/abs/1511.08718): nonlinear least-squares calibration, characteristic-function issues and narrow valleys. This lab uses bounded derivative-free search, not their analytical-gradient method.
- [QuantLib AnalyticHestonEngine documentation](https://rkapl123.github.io/QLAnnotatedSource/d7/d80/class_quant_lib_1_1_analytic_heston_engine.html): preferred continuous-log formulation and branch hazards. No QuantLib code copied.
- [Lord and Kahl](http://www2.math.uni-wuppertal.de/~kahl/publications/complexlogarithmsheston.pdf): complex-log continuity and branch selection.
- [Kassa, Fourier methods for Heston](https://kristofkassa.github.io/derivative_pricing/2023/10/17/fourier_for_heston.html): Lewis formula with drift included in the characteristic function. Our equivalent drift-separated convention is stated explicitly; no example code copied.
- [Financialkit, Lewis formula](https://cpoli.github.io/financialkit/api/gallery/stochastic_volatility/fourier/plot_02_lewis_formula.html): forward-centered version and comparison with two-probability inversion.

Original code is **MIT OR Apache-2.0**, at your option. See [LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE).
