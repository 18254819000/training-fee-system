import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @ApiProperty({ example: '********' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class ExchangeCodeDto {
  @ApiProperty({ description: '一次性登录码', example: 'a1b2-c3d4-...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

export class BindDto {
  @ApiProperty({ description: 'exchange 返回的 exchangeToken，一次性消费' })
  @IsString()
  @IsNotEmpty()
  exchange_token!: string;
}

export class PhoneLoginDto {
  @ApiProperty({ description: '家长手机号', example: '13800001111' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;
}

/** 学生端会话 Cookie 名（前端 withCredentials 自动携带） */
export const STUDENT_SESSION_COOKIE = 'tfs_session';
