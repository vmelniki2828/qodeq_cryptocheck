#!/bin/bash

# Скрипт проверки и обновления .env файла

echo "🔍 Проверка файла .env..."

ENV_FILE="/home/qodeq_cryptocheck/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Файл .env не найден!"
    exit 1
fi

echo "📝 Текущий MONGODB_URI:"
grep MONGODB_URI "$ENV_FILE" | sed 's/\(password\)[^@]*/\1***/g'

echo ""
echo "🔧 Нужно обновить MONGODB_URI на:"
echo "   mongodb://cryptobot:ВАШ_ПАРОЛЬ@localhost:27017/cryptocheck?authSource=cryptocheck"
echo ""
read -p "Введите пароль для cryptobot: " PASSWORD

if [ -z "$PASSWORD" ]; then
    echo "❌ Пароль не может быть пустым!"
    exit 1
fi

# URL-кодирование спецсимволов в пароле
ENCODED_PASSWORD=$(echo -n "$PASSWORD" | sed 's/!/%21/g; s/@/%40/g; s/#/%23/g; s/\$/%24/g; s/&/%26/g; s/*/%2A/g; s/+/%2B/g; s/=/%3D/g; s/?/%3F/g')

# Обновляем .env файл
if grep -q "^MONGODB_URI=" "$ENV_FILE"; then
    # Заменяем существующую строку
    sed -i "s|^MONGODB_URI=.*|MONGODB_URI=mongodb://cryptobot:${ENCODED_PASSWORD}@localhost:27017/cryptocheck?authSource=cryptocheck|" "$ENV_FILE"
else
    # Добавляем новую строку
    echo "MONGODB_URI=mongodb://cryptobot:${ENCODED_PASSWORD}@localhost:27017/cryptocheck?authSource=cryptocheck" >> "$ENV_FILE"
fi

echo ""
echo "✅ Файл .env обновлен!"
echo ""
echo "🔄 Перезапуск бота..."
pm2 restart cryptobot

echo ""
echo "📊 Проверка логов (последние 10 строк):"
sleep 2
pm2 logs cryptobot --lines 10 --nostream

