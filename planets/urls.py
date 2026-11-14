from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='home'),
    
    path('dashboard/', views.dashboard, name='dashboard'), 
    
    path('api/v1/planets/', views.get_planets, name='get_planets'),
]