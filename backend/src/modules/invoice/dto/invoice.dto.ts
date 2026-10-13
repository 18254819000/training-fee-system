import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class GenerateInvoiceDto {
  @ApiProperty({ description: '收费期 ID' }) @IsString() @IsNotEmpty() fee_period_id!: string;

  @ApiPropertyOptional({ description: '校区 ID（可选；不传则按收费期适用校区自动确定）' })
  @IsOptional() @IsString() campus_id?: string;

  @ApiPropertyOptional({ description: '指定学生 ID 列表（可选；不传则为范围内全部在读学生）', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) student_ids?: string[];

  @ApiPropertyOptional({ description: '进一步限定收费项目 ID 列表（须在本期绑定范围内），空=本期全部绑定项目', type: [String] })
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

export class InvoiceQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() fee_period_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() campus_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() student_id?: string;
  @ApiPropertyOptional({ enum: ['pending', 'processing', 'paid', 'refunding', 'refunded', 'voided'] })
  @IsOptional() @IsIn(['pending', 'processing', 'paid', 'refunding', 'refunded', 'voided'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
}
