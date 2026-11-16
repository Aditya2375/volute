package volute;

import java.util.*;

public final class TestRunner {
  static int count = 0;

  static void ok(boolean b) {
    count++;
    if (!b) throw new AssertionError("Assertion " + count);
  }

  static void near(double a, double b, double tol) {
    ok(Double.isFinite(a) && Double.isFinite(b) && Math.abs(a - b) <= tol * (1 + Math.abs(b)));
  }

  static void bad(Runnable r) {
    boolean thrown = false;
    try {
      r.run();
    } catch (IllegalArgumentException | NullPointerException e) {
      thrown = true;
    }
    ok(thrown);
  }

  public static void main(String[] args) {
    for (int corner = 0; corner < 32; corner++) {
      double[] z = new double[5];
      for (int j = 0; j < 5; j++) z[j] = (corner >> j) & 1;
      var p = Engine.decode(z);
      for (double t : new double[] {.25, .5, 1, 2}) {
        near(Engine.characteristic(p, 0, 0, t).re(), 1, 1e-13);
        near(Engine.characteristic(p, 0, 0, t).im(), 0, 1e-13);
        double previous = 101, slope = -1;
        for (double k : new double[] {80, 90, 100, 110, 120}) {
          double price = Engine.price(p, t, k, false),
              fine = Engine.price(p, t, k, true),
              currentSlope = (price - previous) / 10;
          near(price, fine, 2e-7);
          ok(price <= previous + 1e-8);
          if (k > 90) ok(currentSlope >= slope - 1e-8);
          slope = currentSlope;
          previous = price;
          ok(price >= Math.max(0, 100 * Math.exp(-.01 * t) - k * Math.exp(-.02 * t)) - 1e-7);
          ok(price <= 100 * Math.exp(-.01 * t) + 1e-7);
        }
        for (double u : new double[] {.1, 1, 10, 100}) {
          var a = Engine.characteristic(p, u, 0, t);
          var b = Engine.characteristic(p, -u, 0, t);
          near(a.re(), b.re(), 1e-12);
          near(a.im(), -b.im(), 1e-12);
          ok(Math.hypot(a.re(), a.im()) <= 1 + 1e-12);
        }
      }
    }
    for (int surface = 0; surface < 3; surface++)
      for (double noise : new double[] {0, 20, 100}) {
        var c = new Engine.Config(surface, noise, 17);
        var r = Engine.run(c);
        double[] y = Engine.targets(c);
        int selected = 0;
        for (int i = 0; i < 3; i++) {
          var fit = r.fits()[i];
          near(fit.loss(), Engine.loss(fit.params(), y), 1e-13);
          ok(fit.loss() <= fit.initialLoss());
          double previous = Double.POSITIVE_INFINITY;
          for (double v : fit.trace()) {
            ok(v <= previous + 1e-15);
            previous = v;
          }
          near(fit.trace()[fit.trace().length - 1], fit.loss(), 1e-13);
          ok(fit.iterations() <= 350);
          ok(fit.evaluations() <= 2500);
          if (fit.loss() < r.fits()[selected].loss()) selected = i;
        }
        ok(r.selected() == selected);
        double squared = 0, holdout = 0, max = 0;
        int i = 0;
        for (var q : r.quotes()) {
          near(
              q.fitted(),
              Engine.price(r.fits()[selected].params(), q.maturity(), q.strike(), false),
              1e-13);
          near(q.clean(), Engine.price(r.truth(), q.maturity(), q.strike(), false), 1e-13);
          if (q.calibration()) {
            near(q.target(), y[i++], 1e-13);
            squared += (q.fitted() - q.target()) * (q.fitted() - q.target()) / 15;
            max = Math.max(max, Math.abs(q.fitted() - q.target()));
          } else {
            near(q.target(), q.clean(), 1e-13);
            holdout += (q.fitted() - q.clean()) * (q.fitted() - q.clean()) / 6;
          }
        }
        near(r.rmse(), Math.sqrt(squared), 1e-13);
        near(r.holdoutRmse(), Math.sqrt(holdout), 1e-13);
        near(r.maxError(), max, 1e-13);
        ok(r.rmse() < .12);
        ok(r.quadratureGap() < 1e-6);
        if (noise == 0) {
          ok(r.rmse() < .001);
          ok(r.holdoutRmse() < .001);
        }
        double[] changed = y.clone();
        var fit = Engine.fit(changed, 0);
        changed[0] = 99;
        near(fit.loss(), Engine.loss(fit.params(), y), 1e-13);
      }
    var p = Engine.truth(0);
    for (double v : new double[] {Double.NaN, Double.POSITIVE_INFINITY, -1, 100.1})
      bad(() -> Engine.targets(new Engine.Config(0, v, 17)));
    bad(() -> Engine.run(new Engine.Config(3, 0, 17)));
    bad(() -> Engine.run(new Engine.Config(0, 0, 0)));
    bad(() -> Engine.decode(new double[] {.5, .5, .5, .5}));
    bad(() -> Engine.decode(new double[] {.5, .5, Double.NaN, .5, .5}));
    bad(() -> Engine.price(p, .24, 100, false));
    bad(() -> Engine.price(p, 1, 121, false));
    bad(() -> Engine.loss(p, new double[14]));
    near(
        Engine.targets(new Engine.Config(0, 0, 1))[0],
        Engine.targets(new Engine.Config(0, 0, 9999))[0],
        0);
    System.out.println(count + " Java assertions passed");
  }
}
