from pathlib import Path
from datetime import datetime, timezone
import logging
import time

from django.core.management.base import BaseCommand

from planets.catalog import TTL, load, refresh


class Command(BaseCommand):
    help = "Обновить рейтинг по каталогу NASA или его сохранённому CSV"

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group()
        group.add_argument("--input", type=Path)
        group.add_argument("--daily", action="store_true", help="Обновлять снимок каждые 24 часа")

    def handle(self, *args, **options):
        if options["daily"]:
            while True:
                try:
                    try:
                        stamp = datetime.fromisoformat(load()["fetched_at"])
                        delay = TTL - (datetime.now(timezone.utc) - stamp).total_seconds()
                    except (FileNotFoundError, ValueError, KeyError):
                        delay = 0
                    if delay > 0:
                        time.sleep(min(delay, TTL))
                        continue
                    self.update()
                except Exception:
                    logging.getLogger(__name__).exception("Ошибка обновления NASA. Повтор через 5 минут.")
                    time.sleep(300)
        else:
            self.update(options["input"])

    def update(self, path=None):
        data = refresh(path.read_bytes() if path else None)
        self.stdout.write(f"Планет: {data['total']}. С внутренним ESI: {data['rankings']['all']['esi_interior']['available']}.")
