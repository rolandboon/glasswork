export interface User {
  email: string;
  passwordHash: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
}

/** Stand-in for a database; replace it with a Prisma-backed repository. */
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async add(user: User): Promise<void> {
    this.users.set(user.email, user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.get(email) ?? null;
  }
}
