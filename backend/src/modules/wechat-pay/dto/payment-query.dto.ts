import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class PaymentQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() campus_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fee_period_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() out_trade_no?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() date_from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() date_to?: string;
  @ApiPropertyOptional({ description: '订单类型：invoice 账单支付 / reservation 预约课程支付（不传 = 全部）' }) @IsOptional() @IsString() type?: string;
}
