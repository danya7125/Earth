# Первоначальная настройка проекта Earth

Earth — дашборд экзопланет по данным NASA Exoplanet Archive. Он рассчитывает индекс подобия Земле (ESI), определяет положение планет относительно зоны обитаемости по модели Коппарапу и показывает до 50 кандидатов в выбранной подборке.

## Техно-стек

- **Backend** — Python 3.12, Django 5.2.
- **Frontend** — шаблоны Django, Tailwind CSS, JavaScript и Three.js.
- **Хранение данных** — CSV для каталога NASA и JSON для готовых рейтингов.
- **Контейнеризация** — Docker и Docker Compose.

## Требования

Для запуска через Docker нужны Git, Docker Compose и свободный порт `8000`. Для локального запуска понадобится Python 3.12. Обновитель использует интернет для получения каталога NASA.

## Установка и запуск

### 1. Клонирование репозитория

```bash
git clone https://github.com/danya7125/Earth.git
cd Earth
```

### 2. Запуск через Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

Сервис `web` обслуживает сайт и API. Сервис `catalog-worker` раз в сутки загружает каталог NASA и пересчитывает рейтинги. Откройте [дашборд](http://localhost:8000/dashboard/) или [API рейтинга](http://localhost:8000/api/v1/planets/).

### 3. Обновление данных

Чтобы получить свежий каталог сразу, выполните:

```bash
docker compose exec catalog-worker python manage.py refresh_planets
```

| Файл | Содержимое |
| --- | --- |
| `data/nasa_pscomppars.csv` | Все строки ответа NASA по запрашиваемым проектом столбцам. |
| `data/nasa_candidates.json` | Готовые подборки, число обработанных планет и время последнего обновления. Этот файл читает API. |

Во время пересчёта сайт показывает предыдущий готовый рейтинг. Время последнего успешного обновления доступно в поле `fetched_at` ответа API. Посмотреть журнал обновителя можно командой `docker compose logs --tail=50 catalog-worker`, остановить оба сервиса — командой `docker compose down`.

## Локальный запуск без Docker

### 1. Виртуальное окружение

Создайте окружение в папке проекта:

```bash
python -m venv venv
```

| Система | Команда активации |
| --- | --- |
| Windows PowerShell | `.\venv\Scripts\Activate.ps1` |
| Windows cmd | `venv\Scripts\activate.bat` |
| Linux / macOS | `source venv/bin/activate` |

### 2. Установка зависимостей и подготовка данных

```bash
python -m pip install -r requirements.txt
python manage.py refresh_planets
```

### 3. Запуск Django

```bash
python manage.py runserver
```

Откройте [главную страницу](http://localhost:8000/). Для суточного обновления откройте второй терминал, перейдите в папку проекта, активируйте окружение и выполните:

```bash
python manage.py refresh_planets --daily
```

Для проверки проекта выполните `python manage.py test planets`.
