"""NASA catalog quantities, Earth Similarity Index and orbital habitable-zone fractions."""
import math

SIDEREAL_YEAR_DAYS = 365.256363
EARTH_TO_SOLAR_MASS = 3.0034896e-6
PARSEC_TO_LY = 3.26156

COLUMNS = (
    "pl_name", "hostname", "disc_year", "sy_dist",
    "pl_rade", "pl_radelim", "pl_bmasse", "pl_bmasselim",
    "pl_bmassprov", "pl_orbincl", "pl_orbincllim",
    "st_spectype", "st_teff", "st_tefflim",
    "st_lum", "st_lumlim", "st_rad", "st_radlim",
    "st_mass", "st_masslim", "pl_orbsmax", "pl_orbsmaxlim",
    "pl_orbper", "pl_orbperlim", "pl_insol", "pl_insollim",
    "pl_orbeccen", "pl_orbeccenlim",
)

# Table 4, Kopparapu et al. (2014), ApJ, 787, L29: (S_eff_sun, a, b, c, d)
RECENT_VENUS = (1.776, 2.136e-4, 2.533e-8, -1.332e-11, -3.097e-15)
RUNAWAY_01 = (0.990, 1.209e-4, 1.404e-8, -7.418e-12, -1.713e-15)
RUNAWAY_1 = (1.107, 1.332e-4, 1.580e-8, -8.308e-12, -1.931e-15)
RUNAWAY_5 = (1.188, 1.433e-4, 1.707e-8, -8.968e-12, -2.084e-15)
MAX_GREENHOUSE = (0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16)
EARLY_MARS = (0.320, 5.547e-5, 1.526e-9, -2.874e-12, -5.011e-16)


def signed_float(row: dict, name: str) -> float | None:
    try:
        value = float(row.get(name) or "nan")
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def positive_float(row: dict, name: str) -> float | None:
    value = signed_float(row, name)
    return value if value is not None and value > 0 else None


def measured_positive(row: dict, name: str, lim_name: str) -> float | None:
    """Возвращает значение только если NASA не фиксирует верхний/нижний предел (*lim != 0)."""
    if signed_float(row, lim_name) not in (None, 0.0):
        return None
    return positive_float(row, name)


def measured_signed(row: dict, name: str, lim_name: str) -> float | None:
    """Возвращает значение с знаком только при отсутствии флага предела."""
    if signed_float(row, lim_name) not in (None, 0.0):
        return None
    return signed_float(row, name)


def mass_and_source(row: dict) -> tuple[float | None, str]:
    """Строго отбирает динамически измеренную массу; отклоняет эмпирические M-R модели."""
    mass = measured_positive(row, "pl_bmasse", "pl_bmasselim")
    if mass is None:
        return None, "unavailable_or_limit"
    prov = (row.get("pl_bmassprov") or "").lower()
    prov_clean = prov.replace("*", "").replace(" ", "").replace(".", "")
    if "relationship" in prov_clean or "estimate" in prov_clean or "calculated" in prov_clean:
        return None, "rejected_model_mass_from_catalog"
    if prov_clean == "mass" or "/sin(i)" in prov_clean or "/sini" in prov_clean:
        return mass, "true_mass"
    if "sini" in prov_clean or "sin(i)" in prov_clean:
        incl = measured_positive(row, "pl_orbincl", "pl_orbincllim")
        if incl is not None and 0.0 < incl < 180.0:
            sini = math.sin(math.radians(incl))
            if sini > 0.0:
                return mass / sini, "msini_corrected_with_inclination"
        return None, "minimum_mass_only"
    return None, "unrecognised_mass_provenance"


def eccentricity_and_source(row: dict) -> tuple[float, str]:
    """Извлекает строго измеренный эксцентриситет (0 <= e < 1)."""
    ecc = measured_signed(row, "pl_orbeccen", "pl_orbeccenlim")
    if ecc is not None and 0.0 <= ecc < 1.0:
        return ecc, "measured"
    return 0.0, "assumed_circular_or_limit"


def composition_regime(radius_earth: float | None, mass_earth: float | None) -> str:
    """Классификация по критериям Rogers (2015) и PHL Habitable Worlds Catalog."""
    if radius_earth is None or mass_earth is None:
        return "unknown"
    if not (0.5 < radius_earth <= 2.5 and 0.1 < mass_earth <= 10.0):
        return "non_terrestrial"
    if radius_earth <= 1.6 and mass_earth <= 3.0:
        return "conservative_terrestrial"
    return "optimistic_super_earth"


def similarity(value: float, earth_value: float, weight: float) -> float:
    """Индекс сходства Брея-Куртиса (Schulze-Makuch et al., 2011)."""
    if value <= 0 or not math.isfinite(value):
        return math.nan
    return (1.0 - abs((value - earth_value) / (value + earth_value))) ** weight


def esi_interior(radius_earth: float, mass_earth: float) -> float:
    """Интерьерный ESI (Schulze-Makuch et al., 2011)."""
    rho_earth = mass_earth / (radius_earth ** 3)
    return math.sqrt(
        similarity(radius_earth, 1.0, 0.57)
        * similarity(rho_earth, 1.0, 1.07)
    )


def esi_global(radius_earth: float, mass_earth: float,
               surface_temp_kelvin: float) -> float:
    """Глобальный ESI (требует реальную измеренную температуру поверхности Ts)."""
    rho_earth = mass_earth / (radius_earth ** 3)
    escape_earth = math.sqrt(mass_earth / radius_earth)
    terms = (
        similarity(radius_earth, 1.0, 0.57),
        similarity(rho_earth, 1.0, 1.07),
        similarity(escape_earth, 1.0, 0.70),
        similarity(surface_temp_kelvin, 288.0, 5.58),
    )
    return math.prod(terms) ** 0.25


def esi_equilibrium_proxy(radius_earth: float, mass_earth: float,
                          flux_earth: float) -> tuple[float, float]:
    """Чернотельный прокси равновесной температуры с эталоном Земли 255 К (A = 0.3)."""
    eq_temp_k = 255.0 * (flux_earth ** 0.25)
    rho_earth = mass_earth / (radius_earth ** 3)
    escape_earth = math.sqrt(mass_earth / radius_earth)
    terms = (
        similarity(radius_earth, 1.0, 0.57),
        similarity(rho_earth, 1.0, 1.07),
        similarity(escape_earth, 1.0, 0.70),
        similarity(eq_temp_k, 255.0, 5.58),
    )
    return math.prod(terms) ** 0.25, eq_temp_k


def polynomial(teff: float, coeffs: tuple[float, ...]) -> float:
    dt = teff - 5780.0
    return sum(c * (dt ** i) for i, c in enumerate(coeffs))


def kopparapu_limits(teff: float, mass_earth: float | None) -> dict[str, float | str]:
    """Границы зоны обитаемости (Kopparapu et al., 2014) через полиномы 4-й степени."""
    if not 2600 <= teff <= 7200:
        raise ValueError("Kopparapu 2014 temperature range is 2600..7200 K")
    s1 = polynomial(teff, RUNAWAY_1)
    cons_outer = polynomial(teff, MAX_GREENHOUSE)
    opt_inner = polynomial(teff, RECENT_VENUS)
    opt_outer = polynomial(teff, EARLY_MARS)

    if mass_earth is None or not (0.1 <= mass_earth <= 5.0):
        cons_inner = s1
        method = "1M_reference_boundary"
    elif mass_earth <= 1.0:
        s0 = polynomial(teff, RUNAWAY_01)
        cons_inner = s0 + (s1 - s0) * (mass_earth - 0.1) / 0.9
        method = "mass_interpolated_linear"
    else:
        s5 = polynomial(teff, RUNAWAY_5)
        cons_inner = s1 + (s5 - s1) * (mass_earth - 1.0) / 4.0
        method = "mass_interpolated_linear"

    return {
        "cons_inner": cons_inner,
        "cons_outer": cons_outer,
        "opt_inner": opt_inner,
        "opt_outer": opt_outer,
        "method": method,
    }


def mean_anomaly_at_radius_ratio(u: float, ecc: float) -> float:
    """Вычисление средней аномалии M для нормированного радиус-вектора u = r/a на эллипсе."""
    if ecc == 0.0:
        return 0.0 if u <= 1.0 else math.pi
    if u <= 1.0 - ecc:
        return 0.0
    if u >= 1.0 + ecc:
        return math.pi
    cos_e = max(-1.0, min(1.0, (1.0 - u) / ecc))
    ecc_anom = math.acos(cos_e)
    return ecc_anom - ecc * math.sin(ecc_anom)


def hz_orbit_time_fraction(flux_circ: float, ecc: float,
                           s_inner: float, s_outer: float) -> float:
    """Точная доля орбитального периода внутри границ ЗО через уравнение Кеплера."""
    if ecc == 0.0:
        return 1.0 if (s_outer <= flux_circ <= s_inner) else 0.0
    u_in = math.sqrt(flux_circ / s_inner)
    u_out = math.sqrt(flux_circ / s_outer)
    m_in = mean_anomaly_at_radius_ratio(u_in, ecc)
    m_out = mean_anomaly_at_radius_ratio(u_out, ecc)
    return max(0.0, min(1.0, (m_out - m_in) / math.pi))


def flux_and_source(row: dict, teff: float | None,
                    mass_earth: float | None,
                    ecc: float) -> tuple[float | None, float | None, str]:
    """Расчет потока с учетом законов Кеплера и поправки на эксцентриситет."""
    log_lum = measured_signed(row, "st_lum", "st_lumlim")
    stellar_rad = measured_positive(row, "st_rad", "st_radlim")
    lum = 10 ** log_lum if log_lum is not None else None
    if lum is None and stellar_rad is not None and teff is not None:
        lum = (stellar_rad ** 2) * ((teff / 5772.0) ** 4)

    axis = measured_positive(row, "pl_orbsmax", "pl_orbsmaxlim")
    if axis is None:
        period = measured_positive(row, "pl_orbper", "pl_orbperlim")
        star_mass = measured_positive(row, "st_mass", "st_masslim")
        if period is not None and star_mass is not None:
            total_mass_solar = star_mass + (mass_earth or 0.0) * EARTH_TO_SOLAR_MASS
            axis = (total_mass_solar * ((period / SIDEREAL_YEAR_DAYS) ** 2)) ** (1.0 / 3.0)

    flux_circ = None
    source = "insufficient_flux_data"
    if lum is not None and axis is not None and lum > 0:
        flux_circ = lum / (axis ** 2)
        source = "luminosity_and_orbit"
    else:
        insol = measured_positive(row, "pl_insol", "pl_insollim")
        if insol is not None:
            flux_circ = insol
            source = "nasa_pl_insol"

    if flux_circ is None:
        return None, None, source

    flux_avg = flux_circ / math.sqrt(1.0 - ecc ** 2) if 0.0 <= ecc < 1.0 else flux_circ
    return flux_circ, flux_avg, source


def classify(row: dict) -> dict:
    name = (row.get("pl_name") or "").strip()
    host = (row.get("hostname") or "").strip()
    disc_year = (row.get("disc_year") or "").strip()
    dist_pc = positive_float(row, "sy_dist")
    dist_ly = round(dist_pc * PARSEC_TO_LY, 2) if dist_pc is not None else None
    spec_type = (row.get("st_spectype") or "").strip() or "unlisted"

    radius = measured_positive(row, "pl_rade", "pl_radelim")
    mass, mass_source = mass_and_source(row)
    ecc, ecc_source = eccentricity_and_source(row)
    teff = measured_positive(row, "st_teff", "st_tefflim")
    flux_circ, flux_avg, flux_source = flux_and_source(row, teff, mass, ecc)
    regime = composition_regime(radius, mass)

    result = {
        "planet": name,
        "hostname": host,
        "disc_year": disc_year,
        "distance_ly": dist_ly,
        "st_spectype": spec_type,
        "teff_k": teff,
        "radius_re": radius,
        "mass_me": mass,
        "mass_source": mass_source,
        "composition_regime": regime,
        "eccentricity": signed_float(row, "pl_orbeccen"),
        "ecc_used": ecc,
        "ecc_source": ecc_source,
        "flux_circ_earth": flux_circ,
        "flux_earth": flux_avg,
        "flux_periastron": None,
        "flux_apastron": None,
        "flux_source": flux_source,
        "eq_temp_k": None,
        "hz_opt_inner_flux": None,
        "hz_inner_flux": None,
        "hz_outer_flux": None,
        "hz_opt_outer_flux": None,
        "hz_method": "",
        "hz_time_fraction_cons": None,
        "hz_time_fraction_opt": None,
        "in_conservative_hz": None,
        "in_optimistic_hz": None,
        "full_orbit_in_hz_cons": None,
        "full_orbit_in_hz_opt": None,
        "esi_interior": None,
        "esi_equilibrium_proxy": None,
        "esi_global": None,
        "status": "",
    }

    if flux_circ is not None and 0.0 <= ecc < 1.0:
        result["flux_periastron"] = flux_circ / ((1.0 - ecc) ** 2)
        result["flux_apastron"] = flux_circ / ((1.0 + ecc) ** 2)

    if teff is not None and flux_avg is not None and flux_circ is not None and 2600 <= teff <= 7200:
        limits = kopparapu_limits(teff, mass)
        cons_in = limits["cons_inner"]
        cons_out = limits["cons_outer"]
        opt_in = limits["opt_inner"]
        opt_out = limits["opt_outer"]

        f_cons = hz_orbit_time_fraction(flux_circ, ecc, cons_in, cons_out)
        f_opt = hz_orbit_time_fraction(flux_circ, ecc, opt_in, opt_out)

        in_cons = cons_out <= flux_avg <= cons_in
        in_opt = opt_out <= flux_avg <= opt_in

        result.update(
            hz_opt_inner_flux=opt_in,
            hz_inner_flux=cons_in,
            hz_outer_flux=cons_out,
            hz_opt_outer_flux=opt_out,
            hz_method=limits["method"],
            hz_time_fraction_cons=f_cons,
            hz_time_fraction_opt=f_opt,
            in_conservative_hz=in_cons,
            in_optimistic_hz=in_opt,
            full_orbit_in_hz_cons=(f_cons == 1.0),
            full_orbit_in_hz_opt=(f_opt == 1.0),
        )

    if radius is not None and mass is not None:
        result["esi_interior"] = esi_interior(radius, mass)
        if flux_avg is not None:
            esi_eq, eq_temp = esi_equilibrium_proxy(radius, mass, flux_avg)
            result["eq_temp_k"] = eq_temp
            result["esi_equilibrium_proxy"] = esi_eq

        ts = positive_float(row, "surface_temp_k")
        if ts is not None:
            result["esi_global"] = esi_global(radius, mass, ts)

    if result["in_conservative_hz"] is None:
        result["status"] = "insufficient_HZ_data_or_Teff_outside_model"
    elif result["esi_interior"] is None:
        result["status"] = "HZ_known_but_ESI_inputs_missing"
    else:
        result["status"] = "ok"

    return result
