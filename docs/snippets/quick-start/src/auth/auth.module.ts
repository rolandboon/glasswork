import { defineModule } from 'glasswork/core';
import { authRoutes } from './auth.routes';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { InMemoryUserRepository } from './user.repository';

export const AuthModule = defineModule({
  name: 'auth',
  basePath: 'auth', // Routes mounted at /api/auth
  providers: [
    AuthService,
    PasswordService,
    {
      provide: 'userRepository',
      // Seed one user so you can try the login route.
      useFactory: async () => {
        const repository = new InMemoryUserRepository();
        const passwordHash = await new PasswordService().hash('correct-horse');
        await repository.add({ email: 'ada@example.com', passwordHash });
        return repository;
      },
    },
  ],
  routes: authRoutes,
});
