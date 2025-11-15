import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptocheck';

export const connectDB = async () => {
  try {
    console.log('🔄 Попытка подключения к MongoDB...');
    console.log(`📍 URI: ${MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`); // Скрываем пароль в логах
    
    await mongoose.connect(MONGODB_URI, {
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
    } else if (error.message.includes('authentication failed')) {
      console.error('🔴 Ошибка аутентификации!');
      console.error('   Проверьте правильность username и password в MONGODB_URI');
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

