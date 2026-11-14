from django.shortcuts import render
from django.http import JsonResponse
from .models import Exoplanet

def get_planets(request):
    # Достаем первые 50 планет из базы, отсортированных по ESI
    planets = Exoplanet.objects.all()[:50]
    
    data = []
    for p in planets:
        data.append({
            "id": p.id,
            "name": p.name,
            "esi_score": p.esi_score,
            "star_type": p.st_spectype,
            "is_habitable": p.is_habitable
        })
        
    return JsonResponse({
        "status": "success", 
        "count": len(data),
        "data": data
    })

def index(request):
    return render(request, 'index.html')

def dashboard(request):
    return render(request, 'dashboard.html')

