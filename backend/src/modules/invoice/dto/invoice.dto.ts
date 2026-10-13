import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * 批量生成账单（新链路）：校区 → 收费期 → 收费项目 → 预览 → 生成。
 * 校区必填；收费项目不传 = 该收费期绑定的全部启用项目。
 */
export class GenerateInvoiceDto {
  @ApiProperty({ description: '收费期 ID（须为开放状态且属于所选校区）' })
  @IsString() @IsNotEmpty() fee_period_id!: string;

  @ApiProperty({ description: '校区 ID（必填）' })
  @IsString() @IsNotEmpty() campus_id!: string;

  @ApiPropertyOptional({ description: '收费项目 ID 列表（须在本期绑定范围内），空=本期全部绑定项目', type: [String] })
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
