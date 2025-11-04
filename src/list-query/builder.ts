import type { Context } from 'hono';
import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';
import { buildGlobalSearchWhere } from './global-search.js';
import { parseQueryParams } from './parser.js';
import { buildPrismaParams } from './prisma-builder.js';
import type { ParsedQueryParams, PrismaListParams, RawQueryParams, SearchFieldInput } from './types.js';
import type { SchemaValidationConfig, ValidatedListParams } from './validator.js';
import { validateListParams } from './validator.js';

export interface PaginatedResult<T> {
	readonly data: T[];
	readonly total: number;
}

export interface ListQueryConfig<
	TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
	TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> {
	readonly filter?: TWhereSchema;
	readonly sort?: TOrderBySchema;
	readonly search?: readonly SearchFieldInput[];
}

export class ListQueryBuilder<
	TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
	TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> {
	private parsedQuery?: ParsedQueryParams;
	private prismaParams?: PrismaListParams;
	private paginationEnabled = false;
	private context?: Context;
	private whereConditions: Record<string, unknown>[] = [];
	private transformFn?: (
		params: ValidatedListParams<TWhereSchema, TOrderBySchema>,
	) => ValidatedListParams<TWhereSchema, TOrderBySchema>;

	constructor(
		private config: ListQueryConfig<TWhereSchema, TOrderBySchema>,
		private validationConfig?: SchemaValidationConfig<TWhereSchema, TOrderBySchema>,
	) {}

	parse(query: RawQueryParams, context?: Context): this {
		this.parsedQuery = parseQueryParams(query);
		this.prismaParams = buildPrismaParams(this.parsedQuery);
		this.context = context;

		// Apply global search if configured
		if (this.config.search && this.parsedQuery?.search) {
			const searchWhere = buildGlobalSearchWhere(this.config.search, this.parsedQuery.search);
			if (Object.keys(searchWhere).length > 0) {
				this.whereConditions.push(searchWhere);
			}
		}

		return this;
	}

	scope(conditions: InferOutput<TWhereSchema> | Record<string, unknown>): this {
		if (conditions && Object.keys(conditions).length > 0) {
			this.whereConditions.push(conditions as Record<string, unknown>);
		}
		return this;
	}

	paginate(): this {
		this.paginationEnabled = true;
		return this;
	}

	transform(
		fn: (
			params: ValidatedListParams<TWhereSchema, TOrderBySchema>,
		) => ValidatedListParams<TWhereSchema, TOrderBySchema>,
	): this {
		this.transformFn = fn;
		return this;
	}

	build(): ValidatedListParams<TWhereSchema, TOrderBySchema> {
		if (!this.prismaParams) {
			throw new Error('Must call .parse() before .build()');
		}

		// Validate user input first (before merging with application conditions)
		let validatedWhere: Record<string, unknown>;
		let validatedOrderBy: InferOutput<TOrderBySchema>[];

		if (this.validationConfig) {
			const validated = validateListParams(
				this.prismaParams.where,
				this.prismaParams.orderBy,
				this.paginationEnabled ? this.prismaParams.skip : 0,
				this.paginationEnabled ? this.prismaParams.take : 999999,
				this.validationConfig,
			);
			validatedWhere = validated.where as Record<string, unknown>;
			validatedOrderBy = validated.orderBy;
		} else {
			validatedWhere = this.prismaParams.where;
			validatedOrderBy = this.prismaParams.orderBy as InferOutput<TOrderBySchema>[];
		}

		// Now merge with application-controlled conditions (global search, scope)
		let mergedWhere = validatedWhere;
		if (this.whereConditions.length > 0) {
			mergedWhere = this.mergeWhereConditions([validatedWhere, ...this.whereConditions]);
		}

		let params: ValidatedListParams<TWhereSchema, TOrderBySchema> = {
			where: mergedWhere as InferOutput<TWhereSchema>,
			orderBy: validatedOrderBy,
			skip: this.paginationEnabled ? this.prismaParams.skip : 0,
			take: this.paginationEnabled ? this.prismaParams.take : 999999,
		};

		// Apply transform if configured
		if (this.transformFn) {
			params = this.transformFn(params);
		}

		return params;
	}

	async execute<T>(
		callback: (params: ValidatedListParams<TWhereSchema, TOrderBySchema>) => Promise<PaginatedResult<T>>,
	): Promise<T[]> {
		const params = this.build();
		const { data, total } = await callback(params);

		// Set pagination headers if enabled and context available
		if (this.paginationEnabled && this.context && this.parsedQuery) {
			const totalPages = Math.ceil(total / this.parsedQuery.pageSize);
			this.context.header('X-Total-Count', total.toString());
			this.context.header('X-Total-Pages', totalPages.toString());
			this.context.header('X-Current-Page', this.parsedQuery.page.toString());
			this.context.header('X-Page-Size', this.parsedQuery.pageSize.toString());
		}

		return data;
	}

	private mergeWhereConditions(conditions: Record<string, unknown>[]): Record<string, unknown> {
		const nonEmpty = conditions.filter((c) => Object.keys(c).length > 0);
		if (nonEmpty.length === 0) return {};
		if (nonEmpty.length === 1) return nonEmpty[0];
		return { AND: nonEmpty };
	}
}

export function createListQuery<
	TWhereSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
	TOrderBySchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(config: ListQueryConfig<TWhereSchema, TOrderBySchema>) {
	const validationConfig =
		config.filter && config.sort ? { whereSchema: config.filter, orderBySchema: config.sort } : undefined;

	return new ListQueryBuilder(config, validationConfig);
}

