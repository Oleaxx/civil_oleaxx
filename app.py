"""
Generative Structural Design & Structural Health Dashboard
==========================================================
Run with:   streamlit run app.py

Install:    pip install streamlit numpy scipy matplotlib opencv-python-headless pillow
Optional:   pip install ultralytics   (only needed if you supply your own YOLO weights)

Tab 1 - Generative Beam Optimizer: minimises the cross-sectional area of a simply
        supported rectangular beam (centre point load) with scipy.optimize.minimize,
        subject to bending-stress and deflection constraints.
Tab 2 - AI Damage Detector: crack / defect finder for concrete surface photos using an
        OpenCV pipeline (Gaussian blur, adaptive threshold, Canny, contours). A YOLO model
        is used instead only if the user provides a local weights file and ultralytics works.
"""

import io
import os

import numpy as np
import streamlit as st
import matplotlib

matplotlib.use("Agg")  # headless backend: safe for servers
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from PIL import Image, ImageOps

_MISSING = []
try:
    from scipy.optimize import minimize
except ImportError:
    _MISSING.append("scipy")
try:
    import cv2
except ImportError:
    _MISSING.append("opencv-python-headless")

# --------------------------------------------------------------------------------------
# CONSTANTS
# --------------------------------------------------------------------------------------
G = 9.81  # m/s^2

MATERIALS = {
    "Structural Steel": {"sigma": 250e6, "E": 200e9, "rho": 7850.0, "color": "#8fa6bd"},
    "Concrete": {"sigma": 30e6, "E": 30e9, "rho": 2400.0, "color": "#bdbdb2"},
}

B_BOUNDS_MM = (20.0, 3000.0)   # allowed beam width range
H_BOUNDS_MM = (20.0, 5000.0)   # allowed beam height range
MAX_IMAGE_SIDE = 1600          # uploaded images are down-scaled to this for speed
MAX_BOXES = 150                # cap on drawn bounding boxes (keeps the overlay readable)


# --------------------------------------------------------------------------------------
# BEAM OPTIMISATION ENGINE
# --------------------------------------------------------------------------------------
def beam_response(b_m, h_m, L, P, E):
    """Simply supported rectangular beam, centre point load. SI units throughout."""
    M = P * L / 4.0                      # maximum bending moment (N*m)
    I = b_m * h_m ** 3 / 12.0            # second moment of area (m^4)
    S = b_m * h_m ** 2 / 6.0             # section modulus (m^3)
    stress = M / S                       # bending stress (Pa)
    delta = P * L ** 3 / (48.0 * E * I)  # mid-span deflection (m)
    return {"M": M, "I": I, "S": S, "stress": stress, "delta": delta}


def constraint_values(x_mm, L, P, mat, max_ratio):
    """Normalised constraint functions; each must be >= 0 for a feasible design."""
    b, h = x_mm[0] / 1000.0, x_mm[1] / 1000.0
    r = beam_response(b, h, L, P, mat["E"])
    return np.array([
        1.0 - r["stress"] / mat["sigma"],         # stress <= allowable stress
        1.0 - r["delta"] / (L / 360.0),           # deflection <= L/360
        1.0 - (h / b) / max_ratio,                # h/b <= max aspect ratio (practicality)
    ])


def analytic_guess(L, P, mat, ratio):
    """Closed-form starting point assuming the aspect-ratio limit is active."""
    M = P * L / 4.0
    I_req = P * L ** 3 / (48.0 * mat["E"] * (L / 360.0))
    b_stress = (6.0 * M / (mat["sigma"] * ratio ** 2)) ** (1.0 / 3.0)
    b_defl = (12.0 * I_req / ratio ** 3) ** 0.25
    b = max(b_stress, b_defl) * 1000.0
    return np.array([b, b * ratio])


def optimise_beam(L, P_kN, material_name, max_ratio):
    """Minimise area b*h with SciPy SLSQP. Returns a dictionary of results."""
    if not (np.isfinite(L) and np.isfinite(P_kN) and L > 0 and P_kN > 0):
        raise ValueError("Span length and load must be positive numbers.")
    mat = MATERIALS[material_name]
    P = P_kN * 1000.0  # N

    def objective(x):
        return x[0] * x[1] / 1.0e4  # area in units of 10^4 mm^2 (well-scaled for SLSQP)

    constraints = [
        {"type": "ineq", "fun": lambda x, i=i: constraint_values(x, L, P, mat, max_ratio)[i]}
        for i in range(3)
    ]
    bounds = [B_BOUNDS_MM, H_BOUNDS_MM]

    g = analytic_guess(L, P, mat, max_ratio)
    starts = [g, g * 1.3, np.array([300.0, 600.0]), np.array([150.0, 300.0]), np.array([800.0, 1200.0])]

    best = None
    for x0 in starts:
        x0 = np.clip(x0, [B_BOUNDS_MM[0], H_BOUNDS_MM[0]], [B_BOUNDS_MM[1], H_BOUNDS_MM[1]])
        try:
            res = minimize(objective, x0, method="SLSQP", bounds=bounds,
                           constraints=constraints, options={"maxiter": 500, "ftol": 1e-10})
        except Exception:
            continue
        if not np.all(np.isfinite(res.x)):
            continue
        if constraint_values(res.x, L, P, mat, max_ratio).min() < -1e-6:
            continue
        if best is None or objective(res.x) < objective(best.x):
            best = res

    if best is None:
        raise ValueError(
            "No feasible section was found within the allowed size limits "
            f"(b: {B_BOUNDS_MM[0]:.0f}-{B_BOUNDS_MM[1]:.0f} mm, h: {H_BOUNDS_MM[0]:.0f}-{H_BOUNDS_MM[1]:.0f} mm). "
            "Try a smaller span or load, or a larger depth-to-width ratio."
        )

    # Polish so rounding noise can never leave the design infeasible: clamp the aspect ratio, then
    # scale the whole section up in tiny steps (scaling keeps h/b fixed) until stress and deflection pass.
    x = best.x.copy()
    if x[1] > max_ratio * x[0]:
        x[1] = max_ratio * x[0]
    for _ in range(5000):
        if constraint_values(x, L, P, mat, max_ratio)[:2].min() >= 0.0:
            break
        x *= 1.00001

    b_m, h_m = x[0] / 1000.0, x[1] / 1000.0
    resp = beam_response(b_m, h_m, L, P, mat["E"])
    area_m2 = b_m * h_m
    mass = mat["rho"] * area_m2 * L
    util_stress = resp["stress"] / mat["sigma"]
    util_defl = resp["delta"] / (L / 360.0)
    if max(util_stress, util_defl) < 0.99:
        governing = "Depth-to-width ratio / size limits"
    else:
        governing = "Bending stress" if util_stress >= util_defl else "Deflection (L/360)"

    return {
        "b_mm": x[0], "h_mm": x[1], "area_mm2": area_m2 * 1e6,
        "mass_kg": mass, "weight_kN": mass * G / 1000.0,
        "M_kNm": resp["M"] / 1000.0, "I_mm4": resp["I"] * 1e12, "S_mm3": resp["S"] * 1e9,
        "stress_MPa": resp["stress"] / 1e6, "allow_MPa": mat["sigma"] / 1e6,
        "delta_mm": resp["delta"] * 1000.0, "limit_mm": L / 360.0 * 1000.0,
        "util_stress": util_stress, "util_defl": util_defl, "governing": governing,
        "iterations": int(getattr(best, "nit", 0)), "message": str(best.message),
        "color": mat["color"],
    }


def plot_section(b_mm, h_mm, color):
    """2D schematic of the optimised rectangular cross-section."""
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.add_patch(Rectangle((-b_mm / 2, -h_mm / 2), b_mm, h_mm, facecolor=color,
                           edgecolor="black", linewidth=2, hatch="///", alpha=0.9))
    pad = 0.05 * max(b_mm, h_mm)
    ax.plot([-b_mm / 2 - pad, b_mm / 2 + pad], [0, 0], color="crimson", linestyle="--", linewidth=1)
    ax.text(-b_mm / 2 - 1.5 * pad, 0, "N.A.", color="crimson", va="center", ha="right", fontsize=9)
    m = 0.25 * max(b_mm, h_mm)
    # width dimension (below the section)
    ax.annotate("", xy=(-b_mm / 2, -h_mm / 2 - 0.12 * m * 4), xytext=(b_mm / 2, -h_mm / 2 - 0.12 * m * 4),
                arrowprops=dict(arrowstyle="<->", color="black"))
    ax.text(0, -h_mm / 2 - 0.2 * m * 3, f"b = {b_mm:.1f} mm", ha="center", va="top", fontsize=11)
    # height dimension (right of the section)
    ax.annotate("", xy=(b_mm / 2 + 0.12 * m * 4, -h_mm / 2), xytext=(b_mm / 2 + 0.12 * m * 4, h_mm / 2),
                arrowprops=dict(arrowstyle="<->", color="black"))
    ax.text(b_mm / 2 + 0.2 * m * 3, 0, f"h = {h_mm:.1f} mm", ha="left", va="center", rotation=90, fontsize=11)
    ax.set_xlim(-b_mm / 2 - 1.6 * m, b_mm / 2 + 2.2 * m)
    ax.set_ylim(-h_mm / 2 - 1.8 * m, h_mm / 2 + 0.8 * m)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title("Optimised cross-section (to scale)")
    fig.tight_layout()
    return fig


# --------------------------------------------------------------------------------------
# DAMAGE DETECTION (OpenCV fallback + optional YOLO)
# --------------------------------------------------------------------------------------
def load_image(uploaded_file):
    """Read an uploaded file into an RGB uint8 array, fixing orientation and huge sizes."""
    img = Image.open(uploaded_file)
    img = ImageOps.exif_transpose(img).convert("RGB")
    scaled = max(img.size) > MAX_IMAGE_SIDE
    if scaled:
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    return np.array(img), scaled


def _summarise(rgb, overlay, mask, n_defects, extra=None):
    total = mask.size
    defect_px = int(cv2.countNonZero(mask))
    out = {"overlay": overlay, "mask": mask, "n_defects": n_defects,
           "defect_px": defect_px, "total_px": total, "ratio": defect_px / total}
    if extra is not None:
        out["extra"] = extra
    return out


def detect_defects_opencv(rgb, sensitivity, min_size):
    """Gaussian blur -> adaptive threshold + Canny -> contours -> red overlays."""
    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    block = max(11, (min(h, w) // 30) | 1)  # odd neighbourhood size that scales with the image
    adaptive = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                     cv2.THRESH_BINARY_INV, block, max(2, 12 - int(sensitivity)))
    low = max(10, 110 - 9 * int(sensitivity))
    edges = cv2.Canny(blur, low, low * 3)

    near_edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    candidate = cv2.bitwise_and(adaptive, near_edges)  # dark regions that also have strong edges
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    contours = cv2.findContours(candidate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
    # thin cracks have tiny area but long perimeter, so size = max(area, half-perimeter)
    kept = [c for c in contours if max(cv2.contourArea(c), cv2.arcLength(c, True) / 2.0) >= min_size]

    mask = np.zeros((h, w), np.uint8)
    cv2.drawContours(mask, kept, -1, 255, thickness=cv2.FILLED)

    overlay = rgb.copy()
    cv2.drawContours(overlay, kept, -1, (255, 0, 0), 2)  # bright red contours (array is RGB)
    for c in sorted(kept, key=cv2.contourArea, reverse=True)[:MAX_BOXES]:
        x, y, bw, bh = cv2.boundingRect(c)
        cv2.rectangle(overlay, (x, y), (x + bw, y + bh), (255, 215, 0), 2)
    return _summarise(rgb, overlay, mask, len(kept), extra=candidate)


def detect_defects_yolo(rgb, weights_path, conf):
    """Run a user-supplied YOLO model. Raises on any problem so the caller can fall back."""
    from ultralytics import YOLO  # imported lazily so the app works without it

    model = YOLO(weights_path)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    result = model.predict(source=bgr, conf=conf, verbose=False)[0]
    h, w = rgb.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    overlay = rgb.copy()
    n = 0
    for box, cls, score in zip(result.boxes.xyxy.cpu().numpy(),
                               result.boxes.cls.cpu().numpy(),
                               result.boxes.conf.cpu().numpy()):
        x1, y1, x2, y2 = [int(v) for v in box]
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, thickness=cv2.FILLED)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (255, 0, 0), 3)
        label = f"{result.names.get(int(cls), 'defect')} {score:.2f}"
        cv2.putText(overlay, label, (x1, max(15, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
        n += 1
    return _summarise(rgb, overlay, mask, n)


def severity_label(ratio):
    pct = ratio * 100.0
    if pct < 1.0:
        return "Minor (< 1 %)"
    if pct < 5.0:
        return "Moderate (1 - 5 %)"
    return "Severe (> 5 %)"


# --------------------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------------------
def sidebar_config():
    st.sidebar.title("Configuration")
    st.sidebar.header("Beam design")
    cfg = {
        "material": st.sidebar.selectbox("Material", list(MATERIALS.keys())),
        "L": st.sidebar.slider("Span length L (m)", 1.0, 15.0, 6.0, 0.5),
        "P_kN": st.sidebar.slider("Centre point load P (kN)", 10.0, 500.0, 100.0, 5.0),
        "ratio": st.sidebar.slider(
            "Max depth-to-width ratio h/b", 1.0, 6.0, 3.0, 0.25,
            help="Without a limit the optimiser would pick a very thin, tall blade that is impractical "
                 "and prone to lateral buckling."),
    }
    st.sidebar.header("Damage detector")
    cfg["engine"] = st.sidebar.radio("Detection engine",
                                     ["OpenCV pipeline (built-in)", "YOLO (needs local weights)"])
    cfg["sensitivity"] = st.sidebar.slider("Detection sensitivity", 1, 10, 5)
    cfg["min_size"] = st.sidebar.slider("Minimum defect size (px)", 5, 500, 40, 5)
    cfg["weights"] = st.sidebar.text_input("YOLO weights path (.pt)", "",
                                           help="Only used with the YOLO engine. Nothing is downloaded automatically.")
    cfg["conf"] = st.sidebar.slider("YOLO confidence", 0.05, 0.95, 0.25, 0.05)
    st.sidebar.caption("Educational tool. Not a substitute for a qualified engineer's design or inspection.")
    return cfg


def render_beam_tab(cfg):
    st.subheader("Generative Beam Optimizer")
    st.write("Finds the smallest rectangular section (minimum area, hence minimum weight) of a simply "
             "supported beam that still satisfies the stress and deflection limits.")
    c1, c2 = st.columns(2)
    with c1:
        st.latex(r"M=\frac{PL}{4},\quad I=\frac{bh^3}{12},\quad S=\frac{bh^2}{6}")
        st.latex(r"\sigma=\frac{M}{S}\le\sigma_{allow}")
    with c2:
        st.latex(r"\delta=\frac{PL^3}{48EI}\le\frac{L}{360}")
        st.latex(r"\min\; A=b\cdot h")

    mat = MATERIALS[cfg["material"]]
    st.caption(f"{cfg['material']}: allowable stress {mat['sigma']/1e6:.0f} MPa, E = {mat['E']/1e9:.0f} GPa, "
               f"density {mat['rho']:.0f} kg/m³  |  L = {cfg['L']:.1f} m, P = {cfg['P_kN']:.0f} kN, "
               f"h/b ≤ {cfg['ratio']:.2f}")

    inputs = (cfg["material"], cfg["L"], cfg["P_kN"], cfg["ratio"])
    if st.button("Run Generative Optimization", type="primary"):
        try:
            with st.spinner("Optimising..."):
                st.session_state["beam"] = {"inputs": inputs,
                                            "result": optimise_beam(cfg["L"], cfg["P_kN"], cfg["material"], cfg["ratio"])}
        except ValueError as exc:
            st.session_state.pop("beam", None)
            st.error(str(exc))
        except Exception:
            st.session_state.pop("beam", None)
            st.error("The optimisation could not be completed. Please adjust the inputs and try again.")

    saved = st.session_state.get("beam")
    if not saved:
        st.info("Choose the parameters in the sidebar, then click **Run Generative Optimization**.")
        return
    if saved["inputs"] != inputs:
        st.warning("The sidebar settings changed since this result was calculated. Run the optimisation again to update it.")

    try:
        r = saved["result"]
        st.success(f"Optimal section found. Governing check: {r['governing']}.")
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Width b", f"{r['b_mm']:.1f} mm")
        m2.metric("Height h", f"{r['h_mm']:.1f} mm")
        m3.metric("Beam weight", f"{r['weight_kN']:.2f} kN", help=f"Mass: {r['mass_kg']:.1f} kg")
        m4.metric("Cross-section area", f"{r['area_mm2']/100:.1f} cm²")

        left, right = st.columns([1, 1])
        with left:
            st.markdown("**Design check**")
            st.table([
                {"Check": "Max bending moment M", "Value": f"{r['M_kNm']:.2f} kN·m", "Limit": "-", "Utilisation": "-"},
                {"Check": "Bending stress", "Value": f"{r['stress_MPa']:.2f} MPa",
                 "Limit": f"{r['allow_MPa']:.0f} MPa", "Utilisation": f"{r['util_stress']*100:.1f} %"},
                {"Check": "Mid-span deflection", "Value": f"{r['delta_mm']:.2f} mm",
                 "Limit": f"{r['limit_mm']:.2f} mm (L/360)", "Utilisation": f"{r['util_defl']*100:.1f} %"},
                {"Check": "Moment of inertia I", "Value": f"{r['I_mm4']:.3e} mm⁴", "Limit": "-", "Utilisation": "-"},
                {"Check": "Section modulus S", "Value": f"{r['S_mm3']:.3e} mm³", "Limit": "-", "Utilisation": "-"},
            ])
            st.caption(f"SciPy SLSQP finished in {r['iterations']} iterations ({r['message']}). "
                       "Beam self-weight is reported but not added to the applied load.")
        with right:
            fig = plot_section(r["b_mm"], r["h_mm"], r["color"])
            st.pyplot(fig)
            plt.close(fig)
    except Exception:
        st.error("The result could not be displayed. Please run the optimisation again.")


def render_damage_tab(cfg):
    st.subheader("AI Damage Detector")
    st.write("Upload a photo of a concrete surface. The detector highlights possible cracks and defects "
             "and estimates how much of the surface is affected.")
    uploaded = st.file_uploader("Concrete surface image", type=["png", "jpg", "jpeg"])
    if uploaded is None:
        st.info("Upload a PNG, JPG or JPEG image to begin.")
        return

    try:
        rgb, scaled = load_image(uploaded)
    except Exception:
        st.error("That file could not be read as an image. Please upload a valid PNG, JPG or JPEG.")
        return
    if min(rgb.shape[:2]) < 32:
        st.warning("The image is very small. Please upload a larger photo for useful results.")
        return
    if scaled:
        st.caption(f"Large image down-scaled to fit {MAX_IMAGE_SIDE}px for faster analysis.")

    result, method = None, "OpenCV crack & defect finder"
    try:
        with st.spinner("Analysing image..."):
            if cfg["engine"].startswith("YOLO"):
                try:
                    if not cfg["weights"].strip() or not os.path.isfile(cfg["weights"].strip()):
                        raise FileNotFoundError("No valid weights file was provided.")
                    result = detect_defects_yolo(rgb, cfg["weights"].strip(), cfg["conf"])
                    method = "YOLO"
                except Exception:
                    st.warning("YOLO is not configured (package or weights file missing or unusable). "
                               "Using the built-in OpenCV pipeline instead.")
            if result is None:
                result = detect_defects_opencv(rgb, cfg["sensitivity"], cfg["min_size"])
    except Exception:
        st.error("The image could not be analysed. Please try a different image or adjust the detector settings.")
        return

    try:
        col1, col2 = st.columns(2)
        with col1:
            st.image(rgb, caption="Original image")
        with col2:
            st.image(result["overlay"], caption=f"AI-analysed image ({method}; red = defect contours, yellow = boxes)")

        pct = result["ratio"] * 100.0
        m1, m2, m3 = st.columns(3)
        m1.metric("Estimated Surface Degradation Area", f"{pct:.2f} %")
        m2.metric("Defects detected", f"{result['n_defects']}")
        m3.metric("Severity (simulated)", severity_label(result["ratio"]))
        st.write(f"**Estimated Surface Degradation Area:** {pct:.2f} % "
                 f"({result['defect_px']:,} defect pixels out of {result['total_px']:,}).")
        st.caption("This is a simulated screening metric based on image processing. It is not a certified "
                   "inspection result, and shadows, stains or surface texture can create false detections.")

        if "extra" in result:
            with st.expander("Show intermediate detection map"):
                st.image(result["extra"], caption="Candidate defect pixels (adaptive threshold ∩ Canny edges)")

        buf = io.BytesIO()
        Image.fromarray(result["overlay"]).save(buf, format="PNG")
        st.download_button("Download analysed image", buf.getvalue(), file_name="analysed_surface.png", mime="image/png")
    except Exception:
        st.error("The analysis results could not be displayed. Please try again.")


def main():
    st.set_page_config(page_title="Structural Design & Health Dashboard", page_icon="🏗️", layout="wide")
    st.title("Generative Structural Design & Structural Health Dashboard")
    if _MISSING:
        st.error("Missing required packages: " + ", ".join(_MISSING))
        st.code("pip install streamlit numpy scipy matplotlib opencv-python-headless pillow")
        st.stop()
    cfg = sidebar_config()
    tab1, tab2 = st.tabs(["Generative Beam Optimizer", "AI Damage Detector"])
    with tab1:
        render_beam_tab(cfg)
    with tab2:
        render_damage_tab(cfg)


if __name__ == "__main__":
    main()