import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BatchIssueDto {
  @ApiProperty({ description: '学生 ID 列表', type: [String] })
  @IsArray() @IsNotEmpty()
  @IsString({ each: true })
  student_ids!: string[];

  @ApiProperty({ description: '有效期至（ISO 时间），默认 90 天后', example: '2026-12-31T23:59:59+08:00' })
  @IsDateString() @IsNotEmpty()
  expires_at!: string;
}

export class LoginCodeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() student_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() campus_id?: string;
  @ApiPropertyOptional({ enum: ['valid', 'used', 'revoked', 'expired'] })
  @IsOptional() @IsIn(['valid', 'used', 'revoked', 'expired'])
  state?: 'valid' | 'used' | 'revoked' | 'expired';
}
