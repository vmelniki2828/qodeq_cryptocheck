import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// В ESM `dotenv.config()` без path берет .env из process.cwd().
// PM2 может запускать процесс не из корня проекта, поэтому указываем путь явно.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptocheck';

export const connectDB = async () => {
  try {
    console.log('🔄 Попытка подключения к MongoDB...');
    // Иногда env может случайно прийти как "MONGODB_URI=mongodb://..." (с ключом внутри).
    // Тогда соединительная строка ломается ("Invalid scheme"). Нормализуем.
    const normalizedMongodbUri = MONGODB_URI.startsWith('MONGODB_URI=')
      ? MONGODB_URI.slice('MONGODB_URI='.length)
      : MONGODB_URI;

    console.log(
      `📍 URI: ${normalizedMongodbUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`
    ); // Скрываем пароль в логах
    
    await mongoose.connect(normalizedMongodbUri, {
      serverSelectionTimeoutMS: 5000, // Таймаут 5 секунд
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ MongoDB подключена успешно');
    console.log(`📊 База данных: ${mongoose.connection.name}`);
  } catch (error) {
    console.error('\n❌ ОШИБКА ПОДКЛЮЧЕНИЯ К MONGODB');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (error.message.includes('ECONNREFUSED')) {
      console.error('🔴 MongoDB сервер недоступен!');
      console.error('\n💡 Возможные решения:');
      console.error('   1. Убедитесь, что MongoDB установлена');
      console.error('   2. Запустите MongoDB сервис:');
      console.error('      Windows: net start MongoDB');
      console.error('      Linux/Mac: sudo systemctl start mongod');
      console.error('      Или: mongod');
      console.error('   3. Проверьте, что MongoDB слушает на порту 27017');
      console.error('   4. Или используйте MongoDB Atlas (облачный сервис)');
      console.error('\n📖 Инструкция по установке MongoDB:');
      console.error('   https://www.mongodb.com/docs/manual/installation/');
    } else if (error.message.includes('authentication failed') || error.message.includes('requires authentication') || error.code === 13) {
      console.error('🔴 Ошибка аутентификации!');
      console.error('   MongoDB требует аутентификацию, но учетные данные не указаны или неверны');
      console.error('\n💡 Решение:');
      console.error('   1. Проверьте файл .env');
      console.error('   2. Убедитесь, что MONGODB_URI содержит username и password:');
      console.error('      mongodb://username:password@localhost:27017/cryptocheck?authSource=cryptocheck');
      console.error('   3. Если в пароле есть спецсимволы (!, @, #), закодируйте их в URL:');
      console.error('      ! → %21, @ → %40, # → %23');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('🔴 Хост MongoDB не найден!');
      console.error('   Проверьте правильность адреса в MONGODB_URI');
    } else {
      console.error(`🔴 ${error.message}`);
    }
    
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('⚠️  Бот будет работать БЕЗ базы данных');
    console.error('   Функции сохранения данных будут недоступны\n');
    
    // Не завершаем процесс, чтобы бот мог работать без БД
    // process.exit(1);
  }
};

// Обработка отключения
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB отключена');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Ошибка MongoDB:', err);
});

