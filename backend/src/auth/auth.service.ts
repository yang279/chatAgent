import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RegisterDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(dto.email);
    if (exists) throw new ConflictException('邮箱已注册');
    const hash = await bcrypt.hash(dto.password, 10);
    const result = this.db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(dto.email, hash);
    const userId = Number(result.lastInsertRowid);
    return this.sign(userId, dto.email);
  }

  async login(dto: LoginDto) {
    const row = this.db
      .prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .get(dto.email) as { id: number; password_hash: string } | undefined;
    if (!row) throw new UnauthorizedException('邮箱或密码错误');
    const ok = await bcrypt.compare(dto.password, row.password_hash);
    if (!ok) throw new UnauthorizedException('邮箱或密码错误');
    return this.sign(row.id, dto.email);
  }

  private sign(userId: number, email: string) {
    const token = this.jwt.sign({ sub: userId, email });
    return { token, user: { id: userId, email } };
  }
}