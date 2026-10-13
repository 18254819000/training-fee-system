import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCourseDto {
  @ApiProperty({ example: 'JP-N5' }) @IsString() @IsNotEmpty() @MaxLength(32) code!: string;
  @ApiProperty({ example: '日语 N5 基础班' }) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

export class CreateFeeItemDto {
  @ApiProperty({ example: 'FEE-TUITION' }) @IsString() @IsNotEmpty() @MaxLength(32) code!: string;
  @ApiProperty({ example: '学费' }) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() course_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class UpdateFeeItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

export class CreateCampusPriceDto {
  @ApiProperty({ description: '收费项目 ID' }) @IsString() @IsNotEmpty() fee_item_id!: string;
  @ApiProperty({ description: '校区 ID' }) @IsString() @IsNotEmpty() campus_id!: string;
  @ApiProperty({ example: 128000, description: '金额（分），必须为整数' })
  @IsInt() @Min(0) amount_fen!: number;
  @ApiProperty({ example: '2026-09-01', description: '生效日期（含）' })
  @IsDateString() effective_from!: string;
  @ApiPropertyOptional({ example: '2026-12-31', description: '失效日期（含），空=长期有效' })
  @IsOptional() @IsDateString() effective_to?: string;
}

export class CloseCampusPriceDto {
  @ApiProperty({ example: '2026-12-31', description: '将失效日期设为该日（含）' })
  @IsDateString() effective_to!: string;
}
