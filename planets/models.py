from django.db import models

class Exoplanet(models.Model):
    #Базовые идентификаторы
    name = models.CharField(max_length=100, unique=True, verbose_name="Название планеты")
    
    #Сырые данные звезды
    sy_snum = models.IntegerField(null=True, blank=True, verbose_name="Количество звезд в системе")
    st_spectype = models.CharField(max_length=50, null=True, blank=True, verbose_name="Спектральный класс")
    st_teff = models.FloatField(null=True, blank=True, verbose_name="Температура звезды (K)")
    st_mass = models.FloatField(null=True, blank=True, verbose_name="Масса звезды (M_sun)")
    st_rad = models.FloatField(null=True, blank=True, verbose_name="Радиус звезды (R_sun)")
    
    #Сырые данные планеты
    pl_rade = models.FloatField(null=True, blank=True, verbose_name="Радиус (R_earth)")
    pl_bmasse = models.FloatField(null=True, blank=True, verbose_name="Масса (M_earth)")
    pl_orbsmax = models.FloatField(null=True, blank=True, verbose_name="Большая полуось (AU)")
    pl_orbper = models.FloatField(null=True, blank=True, verbose_name="Период обращения (дни)")
    pl_eqt = models.FloatField(null=True, blank=True, verbose_name="Равновесная температура (K)")
    
    # Расчетные поля
    surface_temp = models.FloatField(null=True, blank=True, verbose_name="Расчетная темп. поверхности (K)")
    
    #Индексируем поля (db_index=True), по которым будем делать сортировку для ТОП-50
    esi_score = models.FloatField(null=True, blank=True, db_index=True, verbose_name="Индекс ESI")
    is_habitable = models.BooleanField(default=False, db_index=True, verbose_name="В зоне обитаемости")
    
    #Метаданные для кэширования и проверки актуальности
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exoplanets_data"
        ordering = ['-esi_score'] # База по умолчанию отдаст самых пригодных первыми

    def __str__(self):
        return self.name