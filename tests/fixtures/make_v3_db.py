"""Создаёт настоящую базу формата v3 из tests/fixtures/legacy-v2.json: сначала v2 (make_v2_db.py), затем миграция v2->v3 замороженным кодом server_v3.py.
Запуск: python3 -I make_v3_db.py <путь к .db> <путь к legacy-v2.json>. Рядом с базой появятся keys.json и копия bak-v2 — тесты берут только сам .db."""
import importlib.util, os, subprocess, sys

db_path, fx_path = os.path.abspath(sys.argv[1]), sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, '-I', os.path.join(here, 'make_v2_db.py'), db_path, fx_path], check=True)
os.environ['DATA_DIR'] = os.path.dirname(db_path)
spec = importlib.util.spec_from_file_location('server_v3', os.path.join(here, 'server_v3.py'))
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
old.init_db()
