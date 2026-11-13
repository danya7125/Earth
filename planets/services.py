import requests
import pandas as pd
import io
from .models import Exoplanet

class NasaExoplanetService:
    TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
    
    @classmethod
    def sync_planets(cls):
        print("Начинаем скачивание данных из NASA...")
        
        # Запрашиваем сводную таблицу параметров из NASA TAP API
        query = """
            SELECT pl_name, sy_snum, st_spectype, st_teff, st_mass, st_rad, 
                   pl_rade, pl_bmasse, pl_orbsmax, pl_orbper, pl_eqt 
            FROM pscomppars
        """
        
        response = requests.get(cls.TAP_URL, params={"query": query, "format": "csv"}, timeout=30)
        
        if response.status_code != 200:
            print("Ошибка доступа к NASA API")
            return
            
        # Читаем CSV с помощью Pandas
        df = pd.read_csv(io.StringIO(response.text))
        print(f"Скачано записей: {len(df)}. Сохраняем в базу данных...")
        
        saved_count = 0
        for _, row in df.iterrows():
            pl_eqt = row['pl_eqt'] if pd.notna(row['pl_eqt']) else None
            # Базовый расчет температуры поверхности с поправкой на парниковый эффект (+33K)
            surface_temp = (pl_eqt + 33.0) if pl_eqt is not None else None
            
            defaults = {
                'sy_snum': row['sy_snum'] if pd.notna(row['sy_snum']) else None,
                'st_spectype': row['st_spectype'] if pd.notna(row['st_spectype']) else None,
                'st_teff': row['st_teff'] if pd.notna(row['st_teff']) else None,
                'st_mass': row['st_mass'] if pd.notna(row['st_mass']) else None,
                'st_rad': row['st_rad'] if pd.notna(row['st_rad']) else None,
                'pl_rade': row['pl_rade'] if pd.notna(row['pl_rade']) else None,
                'pl_bmasse': row['pl_bmasse'] if pd.notna(row['pl_bmasse']) else None,
                'pl_orbsmax': row['pl_orbsmax'] if pd.notna(row['pl_orbsmax']) else None,
                'pl_orbper': row['pl_orbper'] if pd.notna(row['pl_orbper']) else None,
                'pl_eqt': pl_eqt,
                'surface_temp': surface_temp,
                'esi_score': 0.0, # Временная заглушка, формулу ESI добавим на следующем шаге
                'is_habitable': False
            }
            
            Exoplanet.objects.update_or_create(
                name=row['pl_name'],
                defaults=defaults
            )
            saved_count += 1
            
        print(f"Успешно синхронизировано планет: {saved_count}")