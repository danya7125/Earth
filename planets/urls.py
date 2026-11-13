from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='home'), 
    # Маршрут для нашего дашборда
    path('api/v1/planets/', views.get_planets, name='get_planets'),
]