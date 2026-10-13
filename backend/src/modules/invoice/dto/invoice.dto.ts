import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateInvoiceDto {
  @ApiProperty({ description: '收费期 ID' }) @IsString() @IsNotEmpty() fee_period_id!: string;

  @ApiPropertyOptional({ description: '校区 ID（与 student_ids 二选一）' })
  @IsOptional() @IsString() campus_id?: string;

  @ApiPropertyOptional({ description: '指定学生 ID 列表（与 campus_id 二选一）', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) student_ids?: string[];

  @ApiPropertyOptional({ description: '指定收费项目 ID 列表，空=该校区全部有效项目', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) fee_item_ids?: string[];

  @ApiPropertyOptional({ description: '幂等键（防重复提交）' })
  @IsOptional() @IsString() idempotency_key?: string;

  @ApiPropertyOptional({ description: '仅预览（不写库），默认 false' })
  @IsOptional() @IsBoolean() preview?: boolean;
}

export class VoidInvoiceDto {
  @ApiPropertyOptional({ description: '作废原因' })
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class InvoiceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() fee_period_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() campus_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() student_id?: string;
  @ApiPropertyOptional({ enum: ['pending', 'processing', 'paid', 'refunding', 'refunded', 'voided'] })
  @IsOptional() @IsIn(['pending', 'processing', 'paid', 'refunding', 'refunded', 'voided'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
}
