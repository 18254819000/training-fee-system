import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class CreateStudentDto {
  @ApiProperty({ example: '张三' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'BJ-HD', description: '校区编码' })
  @IsString() @IsNotEmpty() @MaxLength(32)
  campus_code!: string;

  @ApiPropertyOptional({ example: '2026-001' })
  @IsOptional() @IsString() @MaxLength(64)
  student_no?: string;

  @ApiPropertyOptional({ example: '高一(3)班' })
  @IsOptional() @IsString() @MaxLength(100)
  grade_or_class?: string;

  @ApiPropertyOptional({ example: '13800001111', description: '家长手机号（可选，需明确用途）' })
  @IsOptional() @IsString() @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  guardian_phone?: string;
}

export class UpdateStudentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) student_no?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) grade_or_class?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  guardian_phone?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'left'] })
  @IsOptional() @IsIn(['active', 'inactive', 'left'])
  status?: 'active' | 'inactive' | 'left';
}

export class CreateImportJobDto {
  @ApiProperty({ description: '校区 ID（导入学生归属校区）' })
  @IsString() @IsNotEmpty()
  campus_id!: string;

  @ApiPropertyOptional({ description: '收费期 ID（可选，用于记录导入批次归属）' })
  @IsOptional() @IsString()
  fee_period_id?: string;
}

// Excel/CSV 模板列：姓名*, 校区编码, 班级/年级, 家长手机号, 内部学号
// （与前端 CSV 模板列一致；上传时未指定 campus_id 则按行读取校区编码）
export const IMPORT_TEMPLATE_HEADERS = ['姓名*', '校区编码', '班级/年级', '家长手机号', '内部学号'];
