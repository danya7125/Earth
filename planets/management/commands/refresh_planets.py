from pathlib import Path

from django.core.management.base import BaseCommand

from planets.catalog import refresh


class Command(BaseCommand):
    help = "Обновить рейтинг по каталогу NASA или его сохранённому CSV"

    def add_arguments(self, parser):
        parser.add_argument("--input", type=Path)

    def handle(self, *args, **options):
        path = options["input"]
        data = refresh(path.read_bytes() if path else None)
        self.stdout.write(f"Планет: {data['total']}. С внутренним ESI: {data['rankings']['all']['esi_interior']['available']}.")
