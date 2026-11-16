"""Independent complex arithmetic, probability inversion and SciPy optimizer checks."""
import cmath
import json
import math
import subprocess
import numpy as np
from scipy.integrate import quad, solve_ivp
from scipy.optimize import least_squares
from numpy.polynomial.legendre import leggauss

checks = 0

def near(a, b, tolerance=2e-7):
    global checks
    assert math.isfinite(a) and math.isfinite(b) and abs(a-b) <= tolerance*(1+abs(b)), (a,b,tolerance)
    checks += 1

def java(*args):
    return json.loads(subprocess.check_output(['java','-cp','build/classes','Dump',*map(str,args)],text=True))

def cf(u,t,p):
    v,k,theta,s,rho = p
    b = k-rho*s*1j*u
    d = np.sqrt(b*b+s*s*(u*u+1j*u))
    g = (b-d)/(b+d)
    e = np.exp(-d*t)
    return np.exp(k*theta/s**2*((b-d)*t-2*np.log((1-g*e)/(1-g))) + v*(b-d)/s**2*(1-e)/(1-g*e))

def probability_price(t,strike,p):
    phase = math.log(100/strike)+.01*t
    p2 = .5+quad(lambda u:(cmath.exp(1j*u*phase)*cf(u,t,p)/(1j*u)).real,0,2048,epsabs=1e-10,limit=1000)[0]/math.pi
    p1 = .5+quad(lambda u:(cmath.exp(1j*u*phase)*cf(u-1j,t,p)/(1j*u)).real,0,2048,epsabs=1e-10,limit=1000)[0]/math.pi
    return 100*math.exp(-.01*t)*p1-strike*math.exp(-.02*t)*p2

# Distinct GL construction and panels, used only by an independent optimizer.
nodes,weights=leggauss(64)
u=np.concatenate([(b-a)/2*nodes+(b+a)/2 for a,b in [(0,1),(1,5),(5,20),*[(a,a+32) for a in range(20,1044,32)]]])
w=np.concatenate([(b-a)/2*weights for a,b in [(0,1),(1,5),(5,20),*[(a,a+32) for a in range(20,1044,32)]]])

def optimizer_surface(p):
    out=[]
    for t in [.25,1,2]:
        phi=cf(u-.5j,t,p)
        for k in [80,90,100,110,120]:
            integral=np.sum(w*(np.exp(1j*u*(math.log(100/k)+.01*t))*phi).real/(u*u+.25))
            out.append(100*math.exp(-.01*t)-math.sqrt(100*k)*math.exp(-.015*t)*integral/math.pi)
    return np.array(out)

low=np.array([.02,.6,.02,.15,-.85]);high=np.array([.09,3.5,.09,.75,-.15])
for mask in range(32):
    p=low+(high-low)*np.array([(mask>>i)&1 for i in range(5)])
    for t,k in [(.25,80),(.25,120),(2,80),(2,120)]:
        near(java('price',*p,t,k),probability_price(t,k,p))
    # Independent numerical Riccati ODE, no closed-form branch/log used.
    for z in [1.0,5-.5j]:
        v,k,th,s,rho=p
        def ode(_,y):
            D=y[1]
            return np.array([k*th*D,.5*s*s*D*D+(rho*s*1j*z-k)*D-.5*(z*z+1j*z)])
        sol=solve_ivp(ode,[0,2],np.array([0j,0j]),rtol=2e-10,atol=1e-12)
        assert sol.success
        independent=cmath.exp(sol.y[0,-1]+v*sol.y[1,-1])
        closed=cf(z,2,p)
        near(closed.real,independent.real,1e-8);near(closed.imag,independent.imag,1e-8)

for surface in [0,1,2]:
    for noise,seed in [(0,1),(20,17),(100,9999)]:
        r=java(surface,noise,seed)
        best=r['fits'][r['selected']]
        p=np.array(list(best['params'].values()));truth=np.array(list(r['truth'].values()))
        ys=np.array([q['target'] for q in r['quotes'] if q['calibration']])
        # Rebuild deterministic relative perturbation separately.
        state=seed
        for q in r['quotes']:
            clean=probability_price(q['maturity'],q['strike'],truth)
            fitted=probability_price(q['maturity'],q['strike'],p)
            near(q['clean'],clean);near(q['fitted'],fitted)
            if q['calibration']:
                state=(1664525*state+1013904223)%(2**32)
                near(q['target'],clean*(1+noise/10000*(2*state/(2**32)-1)))
            else:near(q['target'],clean)
        ref=least_squares(lambda x:optimizer_surface(low+x*(high-low))-ys,(p-low)/(high-low),bounds=(np.zeros(5),np.ones(5)),xtol=1e-11,ftol=1e-11,gtol=1e-11,max_nfev=120)
        assert ref.success, (surface,noise,ref.message)
        ref_loss=np.mean(ref.fun**2)
        print(f'fixture surface={surface} noise={noise} seed={seed}: fit MSE={best["loss"]:.10g}, independent local MSE={ref_loss:.10g}, improvement={best["loss"]-ref_loss:.4g}')
        near(best['loss'],np.mean((optimizer_surface(p)-ys)**2),1e-10)
        # A bounded finite-budget NM run is not asserted to be globally optimal.
        assert best['loss'] >= ref_loss-1e-9
        assert best['loss']-ref_loss < 3e-6, (surface,noise,best['loss'],ref_loss)
        checks+=2
print(f'{checks} independent Python complex/probability/ODE/SciPy calibration checks passed')
