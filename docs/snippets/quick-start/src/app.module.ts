import { defineModule } from 'glasswork/core';
import { AuthModule } from './auth/auth.module';

export const AppModule = defineModule({
  name: 'app',
  imports: [AuthModule],
});
