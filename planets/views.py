from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .catalog import load, ranked


@require_GET
def get_planets(request):
    zone = request.GET.get("zone", "all")
    metric = request.GET.get("rank_by", "esi_interior")
    if zone not in ("all", "optimistic", "conservative") or metric not in ("esi_interior", "esi_equilibrium_proxy"):
        return JsonResponse({"status": "error", "message": "Неизвестный режим рейтинга"}, status=400)
    try:
        result = ranked(load(), zone, metric)
    except (OSError, ValueError):
        return JsonResponse({"status": "error", "message": "Каталог NASA временно недоступен"}, status=503)
    return JsonResponse(result)


def index(request):
    try:
        summary = ranked(load())
    except (OSError, ValueError):
        summary = None
    return render(request, "index.html", {"catalog": summary})


def dashboard(request):
    return render(request, "dashboard.html")
