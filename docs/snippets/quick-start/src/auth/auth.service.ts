import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from 'glasswork/http';
import type { PasswordService } from './password.service';
import type { UserRepository } from './user.repository';

export class AuthService {
  private readonly userRepository: UserRepository;
  private readonly passwordService: PasswordService;

  constructor({
    userRepository,
    passwordService,
  }: {
    userRepository: UserRepository;
    passwordService: PasswordService;
  }) {
    this.userRepository = userRepository;
    this.passwordService = passwordService;
  }

  async login(email: string, password: string) {
    const user = await this.userRepository.findByEmail(email);
    if (!user || !(await this.passwordService.verify(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Issue a session the way your auth strategy does; a random token stands in here.
    return {
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}
