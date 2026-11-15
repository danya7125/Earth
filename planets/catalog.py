import csv
import hashlib
import io
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from django.conf import settings

from .science import COLUMNS, classify, measured_positive


TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
TTL = 24 * 3600
def catalog_path():
    return Path(settings.BASE_DIR) / "data" / "nasa_candidates.json"


def calculate(raw):
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    if not set(COLUMNS).issubset(reader.fieldnames or ()):
        raise ValueError("Ответ NASA не содержит обязательных столбцов")
    seen = set()
    scored = []
    for row in reader:
        name = row["pl_name"]
        if not name or name in seen or None in row or None in row.values():
            raise ValueError("Повреждённый каталог NASA")
        seen.add(name)
        p = classify(row)
        if p["esi_interior"] is None:
            continue
        p.update(id=name, name=name, esi_score=p["esi_interior"], pl_rade=p["radius_re"],
                 pl_bmasse=p["mass_me"], pl_eqt=p["eq_temp_k"], star_type=p["st_spectype"],
                 is_habitable=p["in_conservative_hz"],
                 pl_orbper=measured_positive(row,"pl_orbper","pl_orbperlim"),
                 pl_orbsmax=measured_positive(row,"pl_orbsmax","pl_orbsmaxlim"))
        scored.append(p)
    if not seen:
        raise ValueError("Пустой каталог NASA")
    groups = {"all": scored}
    for zone, regimes in (("optimistic", ("conservative_terrestrial", "optimistic_super_earth")),
                          ("conservative", ("conservative_terrestrial",))):
        groups[zone] = [p for p in scored if p["in_"+zone+"_hz"] and p["composition_regime"] in regimes]
    rankings = {}
    for zone, group in groups.items():
        rankings[zone] = {}
        for metric in ("esi_interior", "esi_equilibrium_proxy"):
            ordered = sorted((p for p in group if p[metric] is not None), key=lambda p: (-p[metric], p["name"]))
            rankings[zone][metric] = {"available": len(ordered), "data": ordered[:50]}
    return dict(total=len(seen), fetched_at=datetime.now(timezone.utc).isoformat(),
                sha256=hashlib.sha256(raw).hexdigest(), rankings=rankings)


def refresh(raw=None):
    if raw is None:
        params = urlencode(dict(query="select " + ",".join(COLUMNS) + " from pscomppars", format="csv"))
        with urlopen(TAP + "?" + params, timeout=60) as response:
            raw = response.read()
    data = calculate(raw)
    path = catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
    replace_bytes(path.with_name("nasa_pscomppars.csv"), raw)
    replace_bytes(path, payload)
    return data


def replace_bytes(path, payload):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
    try:
        temp.write_bytes(payload)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def load():
    return json.loads(catalog_path().read_bytes())


def ranked(data, zone="all", metric="esi_interior"):
    group = data["rankings"][zone][metric]
    rows = group["data"]
    return dict(status="success", total=data["total"], count=len(rows), candidates=group["available"], zone=zone,
                fetched_at=data["fetched_at"], sha256=data["sha256"], rank_by=metric,
                data=[dict(p, rank=i, esi_score=p[metric]) for i,p in enumerate(rows,1)])
