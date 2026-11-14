from django.db import models

class Exoplanet(models.Model):
    name = models.CharField(max_length=100, unique=True)
    
    # Звезда
    st_mass = models.FloatField(null=True)
    st_rad = models.FloatField(null=True)
    st_teff = models.FloatField(null=True)
    st_lum = models.FloatField(null=True)
    st_age = models.FloatField(null=True)
    sy_jmag = models.FloatField(null=True)
    sy_snum = models.IntegerField(null=True)
    st_spectype = models.CharField(max_length=50, null=True)
    
    # Планета
    pl_rade = models.FloatField(null=True)
    pl_bmasse = models.FloatField(null=True)
    pl_orbsmax = models.FloatField(null=True)
    pl_orbper = models.FloatField(null=True)
    pl_eqt = models.FloatField(null=True)
    pl_orbeccen = models.FloatField(null=True)
    tran_flag = models.IntegerField(null=True)
    
    # Расчетные физические параметры
    t_surf = models.FloatField(null=True)
    v_esc = models.FloatField(null=True)
    
    # Границы зоны обитаемости (D1-D4)
    hz_d1 = models.FloatField(null=True)
    hz_d2 = models.FloatField(null=True)
    hz_d3 = models.FloatField(null=True)
    hz_d4 = models.FloatField(null=True)
    
    # Индексы
    esi_score = models.FloatField(null=True, db_index=True)
    tsm_score = models.FloatField(null=True)
    
    # SEPHI компоненты
    sephi_l1 = models.FloatField(null=True)
    sephi_l2 = models.FloatField(null=True)
    sephi_l3 = models.FloatField(null=True)
    sephi_l4 = models.FloatField(null=True)
    sephi_total = models.FloatField(null=True, db_index=True)
    
    # Флаги и грейды
    data_grade = models.CharField(max_length=20, default="Gold")
    is_rocky = models.BooleanField(default=False)
    retains_atm = models.BooleanField(default=False)
    is_anomaly = models.BooleanField(default=False)

    class Meta:
        ordering = ['-sephi_total', '-esi_score']