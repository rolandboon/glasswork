import { createRoutes } from 'glasswork/http';
import { LoginDto, SessionDto } from './auth.dto';
import type { AuthService } from './auth.service';

export const authRoutes = createRoutes<{ authService: AuthService }>(
  (router, { authService }, route) => {
    router.post(
      '/login',
      ...route({
        tags: ['Authentication'],
        summary: 'User login with email and password',
        public: true, // Documented without authentication in OpenAPI
        body: LoginDto,
        responses: { 200: SessionDto },
        handler: ({ body }) => {
          // body is typed from LoginDto
          return authService.login(body.email, body.password);
        },
      })
    );
  }
);
