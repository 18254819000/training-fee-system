import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateStudentDto {
  @ApiProperty({ example: '张三' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '校区 ID' })
  @IsString() @IsNotEmpty()
  campus_id!: string;

  @ApiPropertyOptional({ example: '2026-001' })
  @IsOptional() @IsString() @MaxLength(64)
  student_no?: string;

  @ApiPropertyOptional({ example: '高一(3)班' })
  @IsOptional() @IsString() @MaxLength(100)
  grade_or_class?: string;

  @ApiProperty({ example: '13800001111', description: '家长手机号（必填：学生端手机号登录凭证）' })
  @IsString() @IsNotEmpty() @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  guardian_phone!: string;

  @ApiProperty({ description: '绑定的收费项目 ID（必填；须属于学生所在校区）' })
  @IsString() @IsNotEmpty()
  fee_item_id!: string;
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
  @ApiPropertyOptional({ description: '绑定的收费项目 ID（传 null 清空绑定）' })
  @IsOptional() @IsString()
  fee_item_id?: string | null;
}

export class CreateImportJobDto {
  @ApiProperty({ description: '校区 ID（导入学生归属校区）' })
  @IsString() @IsNotEmpty()
  campus_id!: string;

  @ApiPropertyOptional({ description: '收费期 ID（可选，用于记录导入批次归属）' })
  @IsOptional() @IsString()
  fee_period_id?: string;
}

// 收费项目内导入模板列：姓名*, 家长手机号*, 班级/年级
// 导入即分班：行自动绑定该收费项目及其校区；去重/匹配标准为 校区+手机号+姓名
export const FEE_ITEM_IMPORT_HEADERS = ['姓名*', '家长手机号*', '班级/年级'];

export class StudentQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: '校区 ID' })
  @IsOptional() @IsString()
  campus_id?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsOptional() @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '关键词（姓名/学号）' })
  @IsOptional() @IsString()
  keyword?: string;
}
