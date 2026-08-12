#!/usr/bin/env python3
"""
tapo-bridge — опрашивает розетку Tapo с ваттметром и шлёт замеры в «Домовой».

Зачем нужна отдельная программа
-------------------------------
Розетка отвечает по http, в локальной сети и без CORS-заголовков. Страница
приложения, открытая по https, до неё не достучится — это не обходится
настройками, устройство просто не рассчитано на браузер. Поэтому в домашней
сети должно крутиться что-то всегда включённое (Raspberry Pi, мини-ПК, NAS,
роутер с Entware), и это «что-то» — вот этот скрипт.

Почему протокол не написан здесь руками
---------------------------------------
TP-Link не публикует локальный API. Протокол (KLAP) восстановлен сообществом,
он менялся с прошивками и различается у линеек Kasa и Tapo. Написать его
заново «по памяти», не имея под рукой ни спецификации, ни устройства для
проверки, — это выдать код, который с высокой вероятностью не заработает, а
отлаживать байты AES придётся хозяину. Поэтому транспорт берёт python-kasa:
библиотека живая, её гоняют на реальных устройствах, и она сама разбирается
и с KLAP, и со старым протоколом, и с их версиями.

Наш код — всё остальное: опрос, единицы, устойчивость к обрывам и отправка.

Установка
---------
    python3 -m venv ~/tapo-bridge-venv
    ~/tapo-bridge-venv/bin/pip install python-kasa

Проверка одним запуском (ничего никуда не отправит):
    TAPO_EMAIL=... TAPO_PASSWORD=... TAPO_HOST=192.168.0.50 \
        ~/tapo-bridge-venv/bin/python tapo_bridge.py --once

Постоянная работа: см. README.md (systemd).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request

# ── Настройки ───────────────────────────────────────────────────────────────

TAPO_EMAIL = os.environ.get("TAPO_EMAIL", "")
TAPO_PASSWORD = os.environ.get("TAPO_PASSWORD", "")
TAPO_HOST = os.environ.get("TAPO_HOST", "")

INGEST_URL = os.environ.get("DOMOVOY_INGEST_URL", "")
INGEST_TOKEN = os.environ.get("DOMOVOY_TOKEN", "")

# Как часто спрашиваем саму розетку. Запрос локальный и почти бесплатный,
# поэтому часто — чтобы «сейчас» было действительно сейчас
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "5"))

# Как часто отправляем в облако, даже если ничего не изменилось.
#
# Отправка стоит вызова Edge Function, а их в бесплатном тарифе Supabase
# 500 тысяч в месяц. Пуш каждые 10 секунд — это 260 тысяч в месяц на одну
# розетку, то есть half лимита за одну железку. Поэтому в покое шлём редко,
# а на включение и выключение реагируем сразу (см. significant_change)
HEARTBEAT_SECONDS = float(os.environ.get("HEARTBEAT_SECONDS", "60"))

# Что считаем изменением, ради которого стоит потратить вызов.
# Порог в ваттах спасает от дребезга около нуля, порог в долях — от того,
# чтобы чайник на 2 кВт слал пуш на каждые свои ±50 Вт
CHANGE_ABS_W = float(os.environ.get("CHANGE_ABS_W", "5"))
CHANGE_REL = float(os.environ.get("CHANGE_REL", "0.1"))

# Потолок правдоподобия: бытовая розетка на 230 В физически не отдаст больше
# ~3.7 кВт, сама P110 рассчитана на 2300 Вт. Всё, что выше, — это не рекорд
# потребления, а не переведённые в ватты милливатты. Лучше упасть с внятной
# ошибкой, чем показать человеку счёт с лишним нулём
MAX_PLAUSIBLE_W = 4000.0

# Обрыв связи — не повод падать. В том числе поэтому мост ничего не копит:
# накопленные счётчики ведёт сама розетка, и после возврата связи месячный
# расход приедет правильным. Пропущенное время стоит только точек на графике
RETRY_MIN_SECONDS = 5.0
RETRY_MAX_SECONDS = 300.0


def log(message: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {message}", flush=True)


# ── Розетка ─────────────────────────────────────────────────────────────────


async def connect():
    """Находит розетку и возвращает объект устройства."""
    try:
        from kasa import Discover
    except ImportError:
        sys.exit(
            "Не найден python-kasa. Установите его:\n"
            "    python3 -m venv ~/tapo-bridge-venv\n"
            "    ~/tapo-bridge-venv/bin/pip install python-kasa"
        )

    if not TAPO_HOST:
        sys.exit("Нужен TAPO_HOST — адрес розетки в локальной сети (например 192.168.0.50)")
    if not (TAPO_EMAIL and TAPO_PASSWORD):
        sys.exit("Нужны TAPO_EMAIL и TAPO_PASSWORD — те же, что в приложении Tapo")

    device = await Discover.discover_single(
        TAPO_HOST, username=TAPO_EMAIL, password=TAPO_PASSWORD
    )
    await device.update()
    return device


def read_energy(device) -> dict:
    """
    Снимает показания и приводит их к единицам, в которых живёт база: ватты и
    ватт-часы.

    python-kasa уже нормализует то, что розетка отдаёт в милливаттах, и
    выдаёт мощность в ваттах, а расход в киловатт-часах. Полагаться на это
    вслепую всё же не стоит — отсюда проверка правдоподобия ниже.
    """
    try:
        from kasa import Module

        energy = device.modules[Module.Energy]
    except (ImportError, KeyError) as error:
        raise RuntimeError(
            "У устройства нет модуля замера энергии. Убедитесь, что это P110/P115, "
            f"а не P100 без ваттметра. Подробность: {error}"
        ) from error

    power_w = energy.current_consumption
    today_kwh = energy.consumption_today
    month_kwh = energy.consumption_this_month

    if power_w is not None and power_w > MAX_PLAUSIBLE_W:
        raise RuntimeError(
            f"Мощность {power_w} Вт неправдоподобна для бытовой розетки. "
            "Похоже, библиотека отдала милливатты — проверьте версию python-kasa."
        )

    return {
        "device_id": getattr(device, "device_id", None) or device.mac,
        "name": device.alias,
        "power_w": round(power_w, 2) if power_w is not None else None,
        "today_wh": round(today_kwh * 1000, 1) if today_kwh is not None else None,
        "month_wh": round(month_kwh * 1000, 1) if month_kwh is not None else None,
    }


# ── Отправка ────────────────────────────────────────────────────────────────


def push(sample: dict) -> None:
    """Шлёт один замер. Бросает исключение — вызывающий решает, что делать."""
    request = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(sample).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {INGEST_TOKEN}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status >= 300:
            raise RuntimeError(f"Приёмник ответил {response.status}")


def significant_change(current: float | None, last_pushed: float | None) -> bool:
    """
    Стоит ли тратить вызов на этот замер.

    Смотрят обычно не на плавные колебания, а на «включилось / выключилось» —
    поэтому реагируем на заметный скачок сразу, а мелкую рябь пропускаем до
    ближайшего heartbeat.
    """
    if current is None or last_pushed is None:
        return current != last_pushed
    delta = abs(current - last_pushed)
    return delta >= max(CHANGE_ABS_W, last_pushed * CHANGE_REL)


# ── Основной цикл ───────────────────────────────────────────────────────────


async def run(once: bool) -> None:
    device = await connect()
    sample = read_energy(device)

    log(f"розетка: {sample['name']} (device_id {sample['device_id']})")
    log(f"первый замер: {json.dumps(sample, ensure_ascii=False)}")

    if once:
        # Сверьте эти числа с приложением Tapo, прежде чем запускать постоянно:
        # это единственный способ убедиться, что единицы совпали
        log("режим --once: ничего не отправлено")
        return

    if not (INGEST_URL and INGEST_TOKEN):
        sys.exit("Нужны DOMOVOY_INGEST_URL и DOMOVOY_TOKEN — их выдаёт приложение")

    last_pushed_power: float | None = None
    last_push_at = 0.0
    backoff = RETRY_MIN_SECONDS

    while True:
        try:
            await device.update()
            sample = read_energy(device)
            backoff = RETRY_MIN_SECONDS
        except Exception as error:  # noqa: BLE001 — обрыв не должен ронять мост
            log(f"розетка недоступна ({error}); повтор через {backoff:.0f} с")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, RETRY_MAX_SECONDS)
            continue

        now = time.monotonic()
        due = now - last_push_at >= HEARTBEAT_SECONDS
        changed = significant_change(sample["power_w"], last_pushed_power)

        if due or changed:
            try:
                push(sample)
                last_pushed_power = sample["power_w"]
                last_push_at = now
            except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError) as error:
                # Интернета нет или приёмник ответил ошибкой. Ничего не копим:
                # накопительные счётчики ведёт сама розетка, и после возврата
                # связи месячный расход приедет верным
                log(f"не отправилось ({error}); попробую на следующем круге")

        await asyncio.sleep(POLL_SECONDS)


def main() -> None:
    parser = argparse.ArgumentParser(description="Мост Tapo → Домовой")
    parser.add_argument(
        "--once",
        action="store_true",
        help="снять один замер, показать и выйти (проверка настроек)",
    )
    args = parser.parse_args()

    try:
        asyncio.run(run(args.once))
    except KeyboardInterrupt:
        log("остановлен")


if __name__ == "__main__":
    main()
