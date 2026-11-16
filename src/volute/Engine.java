package volute;

import java.util.*;

public final class Engine {
  private Engine() {}

  public record Config(int surface, double noise, int seed) {}

  public record Params(double v0, double kappa, double theta, double sigma, double rho) {}

  public record Quote(
      double maturity,
      double strike,
      double clean,
      double target,
      double fitted,
      boolean calibration) {}

  public record Fit(
      int start,
      Params initial,
      Params params,
      double initialLoss,
      double loss,
      int iterations,
      int evaluations,
      boolean converged,
      int boundary,
      double[] trace) {}

  public record Result(
      Config config,
      Params truth,
      Fit[] fits,
      int selected,
      Quote[] quotes,
      double rmse,
      double holdoutRmse,
      double maxError,
      double feller,
      double quadratureGap) {}

  private static final double[] LOW = {.02, .6, .02, .15, -.85};
  private static final double[] HIGH = {.09, 3.5, .09, .75, -.15};
  private static final double[] EXPIRIES = {.25, 1, 2}, STRIKES = {80, 90, 100, 110, 120};
  private static final double[] EDGES = {
    0, .5, 1, 2, 4, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256
  };
  private static final double[][] STARTS = {
    {.3, .3, .3, .3, .3}, {.7, .65, .6, .7, .2}, {.5, .8, .2, .3, .8}
  };
  private static final double[][] QUAD = quadrature(16, 1024), FINE = quadrature(32, 2048);

  public static Config defaults() {
    return new Config(0, 20, 17);
  }

  public static void validate(Config c) {
    if (c == null
        || c.surface < 0
        || c.surface > 2
        || !Double.isFinite(c.noise)
        || c.noise < 0
        || c.noise > 100
        || c.seed < 1
        || c.seed > 9999)
      throw new IllegalArgumentException(
          "Surface 0..2, relative noise 0..100 bps, integer seed 1..9999 required");
  }

  private static double[] array(Params p) {
    return new double[] {p.v0, p.kappa, p.theta, p.sigma, p.rho};
  }

  public static void validate(Params p) {
    if (p == null) throw new IllegalArgumentException("Parameters required");
    double[] a = array(p);
    for (int i = 0; i < 5; i++)
      if (!Double.isFinite(a[i]) || a[i] < LOW[i] || a[i] > HIGH[i])
        throw new IllegalArgumentException("Parameters outside declared pricing box");
  }

  public static Params truth(int surface) {
    return switch (surface) {
      case 0 -> new Params(.045, 1.7, .05, .42, -.62);
      case 1 -> new Params(.07, .9, .032, .6, -.78);
      case 2 -> new Params(.025, 2.8, .065, .25, -.3);
      default -> throw new IllegalArgumentException("Surface 0..2 required");
    };
  }

  public static Params decode(double[] x) {
    if (x == null || x.length != 5) throw new IllegalArgumentException("Five coordinates required");
    double[] a = new double[5];
    for (int i = 0; i < 5; i++) {
      if (!Double.isFinite(x[i]) || x[i] < 0 || x[i] > 1)
        throw new IllegalArgumentException("Coordinates in 0..1 required");
      a[i] = LOW[i] + x[i] * (HIGH[i] - LOW[i]);
    }
    return new Params(a[0], a[1], a[2], a[3], a[4]);
  }

  public record Complex(double re, double im) {
    Complex add(Complex z) {
      return new Complex(re + z.re, im + z.im);
    }

    Complex sub(Complex z) {
      return new Complex(re - z.re, im - z.im);
    }

    Complex mul(Complex z) {
      return new Complex(re * z.re - im * z.im, re * z.im + im * z.re);
    }

    Complex scale(double a) {
      return new Complex(re * a, im * a);
    }

    Complex div(Complex z) {
      double s = z.re * z.re + z.im * z.im;
      return new Complex((re * z.re + im * z.im) / s, (im * z.re - re * z.im) / s);
    }

    Complex exp() {
      double a = Math.exp(re);
      return new Complex(a * Math.cos(im), a * Math.sin(im));
    }

    Complex log() {
      return new Complex(Math.log(Math.hypot(re, im)), Math.atan2(im, re));
    }

    Complex sqrt() {
      double h = Math.hypot(re, im);
      return new Complex(
          Math.sqrt((h + re) / 2), Math.copySign(Math.sqrt(Math.max(0, (h - re) / 2)), im));
    }
  }

  private static final Complex ONE = new Complex(1, 0);

  // Characteristic function of log(S_T/S_0)-(r-q)T. No drift factor here.
  public static Complex characteristic(Params p, double u, double imaginary, double t) {
    validate(p);
    if (!Double.isFinite(u)
        || Math.abs(u) > 512
        || !Double.isFinite(imaginary)
        || imaginary < -.5
        || imaginary > 0
        || !Double.isFinite(t)
        || t < .25
        || t > 2)
      throw new IllegalArgumentException("CF domain: |u|<=512, imaginary -0.5..0, T0.25..2");
    return cf(p, u, imaginary, t);
  }

  private static Complex cf(Params p, double u, double imaginary, double t) {
    Complex z = new Complex(u, imaginary),
        iz = new Complex(-imaginary, u),
        b = ONE.scale(p.kappa).sub(iz.scale(p.rho * p.sigma)),
        d = b.mul(b).add(z.mul(z).add(iz).scale(p.sigma * p.sigma)).sqrt(),
        g = b.sub(d).div(b.add(d)),
        e = d.scale(-t).exp(),
        den = ONE.sub(g.mul(e));
    Complex c =
        b.sub(d)
            .scale(t)
            .sub(den.div(ONE.sub(g)).log().scale(2))
            .scale(p.kappa * p.theta / (p.sigma * p.sigma));
    Complex v = b.sub(d).scale(1 / (p.sigma * p.sigma)).mul(ONE.sub(e).div(den)).scale(p.v0);
    return c.add(v).exp();
  }

  private static double[][] quadrature(int n, int upper) {
    ArrayList<Double> edges = new ArrayList<>();
    for (double e : EDGES) edges.add(e);
    for (int e = 288; e <= 512; e += 32) edges.add((double) e);
    for (int e = 576; e <= upper; e += 64) edges.add((double) e);
    ArrayList<double[]> a = new ArrayList<>();
    for (int panel = 0; panel < edges.size() - 1; panel++) {
      double mid = (edges.get(panel) + edges.get(panel + 1)) / 2,
          half = (edges.get(panel + 1) - edges.get(panel)) / 2;
      for (int i = 0; i < n; i++) {
        double z = Math.cos(Math.PI * (i + .75) / (n + .5)), dp = 0;
        for (int it = 0; it < 30; it++) {
          double p0 = 1, p1 = z;
          for (int j = 2; j <= n; j++) {
            double p2 = ((2 * j - 1) * z * p1 - (j - 1) * p0) / j;
            p0 = p1;
            p1 = p2;
          }
          dp = n * (z * p1 - p0) / (z * z - 1);
          double next = z - p1 / dp;
          if (Math.abs(next - z) < 1e-15) {
            z = next;
            break;
          }
          z = next;
        }
        // Re-evaluate derivative at the final node.
        double p0 = 1, p1 = z;
        for (int j = 2; j <= n; j++) {
          double p2 = ((2 * j - 1) * z * p1 - (j - 1) * p0) / j;
          p0 = p1;
          p1 = p2;
        }
        dp = n * (z * p1 - p0) / (z * z - 1);
        a.add(new double[] {mid + half * z, half * 2 / ((1 - z * z) * dp * dp)});
      }
    }
    a.sort(Comparator.comparingDouble(x -> x[0]));
    return a.toArray(double[][]::new);
  }

  private static double[] prices(Params p, double t, double[] strikes, boolean fine) {
    double[][] q = fine ? FINE : QUAD;
    double[] sums = new double[strikes.length];
    for (double[] node : q) {
      double u = node[0];
      Complex phi = cf(p, u, -.5, t);
      for (int j = 0; j < strikes.length; j++) {
        double phase = u * (Math.log(100 / strikes[j]) + .01 * t);
        sums[j] += node[1] * (Math.cos(phase) * phi.re - Math.sin(phase) * phi.im) / (u * u + .25);
      }
    }
    for (int j = 0; j < sums.length; j++) {
      sums[j] =
          100 * Math.exp(-.01 * t)
              - Math.sqrt(100 * strikes[j]) * Math.exp(-.015 * t) * sums[j] / Math.PI;
      if (!Double.isFinite(sums[j])
          || sums[j]
              < Math.max(0, 100 * Math.exp(-.01 * t) - strikes[j] * Math.exp(-.02 * t)) - 1e-7
          || sums[j] > 100 * Math.exp(-.01 * t) + 1e-7)
        throw new IllegalArgumentException("Pricing integral violates call bounds");
    }
    return sums;
  }

  public static double price(Params p, double t, double strike, boolean fine) {
    validate(p);
    if (!Double.isFinite(t)
        || t < .25
        || t > 2
        || !Double.isFinite(strike)
        || strike < 80
        || strike > 120) throw new IllegalArgumentException("Pricing T0.25..2, K80..120 required");
    return prices(p, t, new double[] {strike}, fine)[0];
  }

  public static double[] surface(Params p) {
    validate(p);
    double[] r = new double[15];
    int i = 0;
    for (double t : EXPIRIES) for (double v : prices(p, t, STRIKES, false)) r[i++] = v;
    return r;
  }

  public static double[] targets(Config c) {
    validate(c);
    double[] a = surface(truth(c.surface));
    long s = c.seed;
    for (int i = 0; i < a.length; i++) {
      s = (1664525 * s + 1013904223) & 0xffffffffL;
      a[i] *= 1 + c.noise / 10000 * (2 * s / 4294967296.0 - 1);
    }
    return a;
  }

  private static void validateTargets(double[] targets) {
    if (targets == null || targets.length != 15)
      throw new IllegalArgumentException("15 targets required");
    for (double v : targets)
      if (!Double.isFinite(v) || v < 0 || v > 100)
        throw new IllegalArgumentException("Finite target prices in 0..100 required");
  }

  public static double loss(Params p, double[] targets) {
    validateTargets(targets);
    return objective(p, targets);
  }

  private static double objective(Params p, double[] y) {
    double[] a = surface(p);
    double l = 0;
    for (int i = 0; i < 15; i++) l += (a[i] - y[i]) * (a[i] - y[i]) / 15;
    return l;
  }

  private record Vertex(double[] x, double value) {}

  private static double[] bounded(double[] c, double[] w, double scale) {
    double[] x = new double[5];
    for (int j = 0; j < 5; j++) x[j] = Math.max(0, Math.min(1, c[j] + scale * (c[j] - w[j])));
    return x;
  }

  public static Fit fit(double[] targets, int start) {
    if (start < 0 || start > 2) throw new IllegalArgumentException("Start 0..2 required");
    validateTargets(targets);
    double[] y = targets.clone();
    Vertex[] v = new Vertex[6];
    int evaluations = 0;
    for (int i = 0; i < 6; i++) {
      double[] x = STARTS[start].clone();
      if (i > 0) x[i - 1] += .08;
      v[i] = new Vertex(x, objective(decode(x), y));
      evaluations++;
    }
    double initialLoss = v[0].value;
    ArrayList<Double> trace = new ArrayList<>();
    boolean converged = false;
    int iter = 0;
    for (; iter < 350; iter++) {
      Arrays.sort(v, Comparator.comparingDouble(Vertex::value));
      trace.add(v[0].value);
      double diameter = 0;
      for (int i = 1; i < 6; i++)
        for (int j = 0; j < 5; j++) diameter = Math.max(diameter, Math.abs(v[i].x[j] - v[0].x[j]));
      if (diameter < 2e-5 && v[5].value - v[0].value < 1e-10) {
        converged = true;
        break;
      }
      double[] c = new double[5];
      for (int i = 0; i < 5; i++) for (int j = 0; j < 5; j++) c[j] += v[i].x[j] / 5;
      double[] xr = bounded(c, v[5].x, 1);
      Vertex reflected = new Vertex(xr, objective(decode(xr), y));
      evaluations++;
      if (reflected.value < v[0].value) {
        double[] xe = bounded(c, v[5].x, 2);
        Vertex expanded = new Vertex(xe, objective(decode(xe), y));
        evaluations++;
        v[5] = expanded.value < reflected.value ? expanded : reflected;
      } else if (reflected.value < v[4].value) v[5] = reflected;
      else {
        boolean outside = reflected.value < v[5].value;
        double[] xc = bounded(c, outside ? reflected.x : v[5].x, -.5);
        Vertex contracted = new Vertex(xc, objective(decode(xc), y));
        evaluations++;
        if (contracted.value < (outside ? reflected.value : v[5].value)) v[5] = contracted;
        else
          for (int i = 1; i < 6; i++) {
            double[] xs = new double[5];
            for (int j = 0; j < 5; j++) xs[j] = (v[0].x[j] + v[i].x[j]) / 2;
            v[i] = new Vertex(xs, objective(decode(xs), y));
            evaluations++;
          }
      }
    }
    Arrays.sort(v, Comparator.comparingDouble(Vertex::value));
    if (trace.isEmpty() || trace.getLast() != v[0].value) trace.add(v[0].value);
    int boundary = 0;
    for (double x : v[0].x) if (x <= 1e-5 || x >= 1 - 1e-5) boundary++;
    return new Fit(
        start,
        decode(STARTS[start]),
        decode(v[0].x),
        initialLoss,
        v[0].value,
        iter,
        evaluations,
        converged,
        boundary,
        trace.stream().mapToDouble(Double::doubleValue).toArray());
  }

  public static Result run(Config c) {
    validate(c);
    double[] y = targets(c), clean = surface(truth(c.surface));
    Fit[] fits = new Fit[3];
    int best = 0;
    for (int i = 0; i < 3; i++) {
      fits[i] = fit(y, i);
      if (fits[i].loss < fits[best].loss) best = i;
    }
    Params p = fits[best].params;
    double[] a = surface(p);
    ArrayList<Quote> quotes = new ArrayList<>();
    double max = 0, gap = 0;
    int i = 0;
    for (double t : EXPIRIES)
      for (double k : STRIKES) {
        quotes.add(new Quote(t, k, clean[i], y[i], a[i], true));
        max = Math.max(max, Math.abs(a[i] - y[i]));
        gap = Math.max(gap, Math.abs(price(p, t, k, true) - a[i]));
        i++;
      }
    double holdout = 0;
    for (double t : new double[] {.5, 1.5})
      for (double k : new double[] {85, 100, 115}) {
        double truthPrice = price(truth(c.surface), t, k, false), fp = price(p, t, k, false);
        quotes.add(new Quote(t, k, truthPrice, truthPrice, fp, false));
        holdout += (fp - truthPrice) * (fp - truthPrice) / 6;
        gap = Math.max(gap, Math.abs(price(p, t, k, true) - fp));
      }
    return new Result(
        c,
        truth(c.surface),
        fits,
        best,
        quotes.toArray(Quote[]::new),
        Math.sqrt(fits[best].loss),
        Math.sqrt(holdout),
        max,
        2 * p.kappa * p.theta - p.sigma * p.sigma,
        gap);
  }
}
