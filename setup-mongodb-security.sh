#!/bin/bash

# Скрипт настройки безопасности MongoDB

set -e

echo "🔒 Настройка безопасности MongoDB..."

# Проверка, запущена ли MongoDB
if ! systemctl is-active --quiet mongod 2>/dev/null; then
    echo "🚀 Запуск MongoDB..."
    sudo systemctl start mongod
    sleep 2
fi

# Проверка подключения
if ! mongosh --eval "db.adminCommand('ping')" --quiet > /dev/null 2>&1; then
    echo "❌ MongoDB не запущена или недоступна"
    echo "Попробуйте: sudo systemctl start mongod"
    exit 1
fi

echo "✅ MongoDB запущена"

# Запрос пароля
echo ""
read -sp "Введите пароль для пользователя cryptobot: " PASSWORD
echo ""
read -sp "Подтвердите пароль: " PASSWORD_CONFIRM
echo ""

if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
    echo "❌ Пароли не совпадают!"
    exit 1
fi

if [ -z "$PASSWORD" ] || [ ${#PASSWORD} -lt 8 ]; then
    echo "❌ Пароль должен быть минимум 8 символов!"
    exit 1
fi

echo "📝 Создание пользователя cryptobot..."

# Создание пользователя через mongosh
mongosh --quiet <<EOF
use cryptocheck
try {
    db.createUser({
        user: "cryptobot",
        pwd: "$PASSWORD",
        roles: [ { role: "readWrite", db: "cryptocheck" } ]
    })
    print("✅ Пользователь cryptobot создан успешно")
} catch(e) {
    if (e.codeName === 'DuplicateKey') {
        print("⚠️  Пользователь cryptobot уже существует")
        print("🔄 Обновление пароля...")
        db.changeUserPassword("cryptobot", "$PASSWORD")
        print("✅ Пароль обновлен")
    } else {
        print("❌ Ошибка: " + e.message)
        throw e
    }
}
EOF

echo ""
echo "🔐 Включение аутентификации..."

# Включение аутентификации в конфиге
if [ -f /etc/mongod.conf ]; then
    # Проверяем, есть ли уже security секция
    if ! grep -q "^security:" /etc/mongod.conf; then
        echo "security:" | sudo tee -a /etc/mongod.conf
        echo "  authorization: enabled" | sudo tee -a /etc/mongod.conf
    else
        # Если есть, проверяем authorization
        if ! grep -q "authorization: enabled" /etc/mongod.conf; then
            sudo sed -i '/^security:/a\  authorization: enabled' /etc/mongod.conf
        fi
    fi
    
    echo "✅ Конфигурация обновлена"
    echo "🔄 Перезапуск MongoDB..."
    sudo systemctl restart mongod
    sleep 3
    
    echo "✅ MongoDB перезапущена с аутентификацией"
else
    echo "⚠️  Файл /etc/mongod.conf не найден"
    echo "   Вручную добавьте в конфиг:"
    echo "   security:"
    echo "     authorization: enabled"
fi

echo ""
echo "🛡️  Настройка firewall..."

# Закрытие порта от внешнего доступа
if command -v ufw &> /dev/null; then
    sudo ufw deny 27017/tcp 2>/dev/null || true
    echo "✅ Порт 27017 закрыт от внешнего доступа"
else
    echo "⚠️  ufw не установлен, настройте firewall вручную"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Настройка безопасности завершена!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Обновите файл .env:"
echo "   MONGODB_URI=mongodb://cryptobot:ВАШ_ПАРОЛЬ@localhost:27017/cryptocheck?authSource=cryptocheck"
echo ""
echo "   Замените ВАШ_ПАРОЛЬ на пароль, который вы ввели"
echo ""

