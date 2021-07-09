import { SchemaObject } from 'openapi3-ts';
import merge from 'ts-deepmerge';
import { AnyZodObject, z, ZodTypeAny } from 'zod';

export interface OpenApiZodAny extends ZodTypeAny {
  metaOpenApi?: SchemaObject | SchemaObject[];
}

interface OpenApiZodAnyObject extends AnyZodObject {
  metaOpenApi?: SchemaObject | SchemaObject[];
}

interface ParsingArgs<T> {
  zodRef: T;
  schemas: SchemaObject[];
  useOutput?: boolean;
}

export function openApi<T extends OpenApiZodAny>(
  schema: T,
  SchemaObject: SchemaObject = {}
): T {
  schema.metaOpenApi = SchemaObject;
  return schema;
}

function iterateZodObject({
  zodRef,
  schemas,
  useOutput,
}: ParsingArgs<OpenApiZodAnyObject>) {
  return Object.keys(zodRef.shape).reduce(
    (carry, key) => ({
      ...carry,
      [key]: generateSchema({ zodRef: zodRef.shape[key], schemas, useOutput }),
    }),
    {} as Record<string, SchemaObject>
  );
}

function parseTransformation({
  zodRef,
  schemas,
  useOutput,
}: ParsingArgs<z.ZodTransformer<never> | z.ZodEffects<never>>): SchemaObject {
  const input = generateSchema({
    zodRef: zodRef._def.schema,
    useOutput,
  });

  let output = 'undefined';
  if (useOutput && zodRef._def.effects && zodRef._def.effects.length > 0) {
    const effect = zodRef._def.effects
      .filter((ef) => ef.type === 'transform')
      .slice(-1)[0];
    if (effect && 'transform' in effect) {
      try {
        output = typeof effect.transform(
          ['integer', 'number'].includes(`${input.type}`)
            ? 0
            : 'string' === input.type
            ? ''
            : 'boolean' === input.type
            ? false
            : 'object' === input.type
            ? {}
            : 'null' === input.type
            ? null
            : 'array' === input.type
            ? []
            : undefined
        );
      } catch (e) {
        /**/
      }
    }
  }
  return merge(
    {
      ...input,
      ...(['number', 'string', 'boolean', 'null'].includes(output)
        ? {
            type: output as 'number' | 'string' | 'boolean' | 'null',
          }
        : {}),
    },
    ...schemas
  );
}

function parseString({
  zodRef,
  schemas,
}: ParsingArgs<z.ZodString>): SchemaObject {
  const baseSchema: SchemaObject = {
    type: 'string',
  };
  const { checks = [] } = zodRef._def;
  checks.forEach((item) => {
    switch (item.kind) {
      case 'email':
        baseSchema.format = 'email';
        break;
      case 'uuid':
        baseSchema.format = 'uuid';
        break;
      case 'url':
        baseSchema.format = 'uri';
        break;
      case 'max':
        baseSchema.maxLength = item.value;
        break;
      case 'min':
        baseSchema.minLength = item.value;
        break;
      case 'regex':
        baseSchema.regex = item.regex;
        break;
    }
  });
  return merge(baseSchema, ...schemas);
}

function parseNumber({
  zodRef,
  schemas,
}: ParsingArgs<z.ZodNumber>): SchemaObject {
  const baseSchema: SchemaObject = {
    type: 'number',
  };
  const { checks = [] } = zodRef._def;
  checks.forEach((item) => {
    switch (item.kind) {
      case 'max':
        baseSchema.maximum = item.value - (item.inclusive ? 0 : 1);
        break;
      case 'min':
        baseSchema.minimum = item.value + (item.inclusive ? 0 : 1);
        break;
      case 'int':
        baseSchema.type = 'integer';
        break;
    }
  });
  return merge(baseSchema, ...schemas);
}

function parseObject({
  zodRef,
  schemas,
  useOutput,
}: ParsingArgs<z.ZodObject<never> | z.ZodRecord>): SchemaObject {
  return merge(
    {
      type: 'object',
      properties: iterateZodObject({
        zodRef: zodRef as OpenApiZodAnyObject,
        schemas,
        useOutput,
      }),
      required: Object.keys((zodRef as z.AnyZodObject).shape).filter(
        (key) =>
          !(zodRef as z.AnyZodObject).shape[key].isOptional() &&
          !((zodRef as z.AnyZodObject).shape[key] instanceof z.ZodNever)
      ),
    },
    ...schemas
  );
}

function parseBigInt({ schemas }: ParsingArgs<z.ZodBigInt>): SchemaObject {
  return merge({ type: 'integer', format: 'int64' }, ...schemas);
}

function parseBoolean({ schemas }: ParsingArgs<z.ZodBoolean>): SchemaObject {
  return merge({ type: 'boolean' }, ...schemas);
}

function parseDate({ schemas }: ParsingArgs<z.ZodDate>): SchemaObject {
  return merge({ type: 'string', format: 'date-time' }, ...schemas);
}

function parseNull({ schemas }: ParsingArgs<z.ZodNull>): SchemaObject {
  return merge(
    {
      type: 'string',
      format: 'null',
      nullable: true,
    },
    ...schemas
  );
}

function parseOptionalNullable({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<
  z.ZodOptional<OpenApiZodAny> | z.ZodNullable<OpenApiZodAny>
>): SchemaObject {
  return merge(generateSchema({ zodRef, useOutput }), ...schemas);
}

function parseArray({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<z.ZodArray<OpenApiZodAny>>): SchemaObject {
  return merge(
    {
      type: 'array',
      items: generateSchema({ zodRef: zodRef._def.type, useOutput }),
    },
    ...schemas
  );
}

function parseLiteral({
  schemas,
  zodRef,
}: ParsingArgs<z.ZodLiteral<OpenApiZodAny>>): SchemaObject {
  return merge(
    {
      type: typeof zodRef._def.value as 'string' | 'number' | 'boolean',
      enum: [zodRef._def.value],
    },
    ...schemas
  );
}

function parseEnum({
  schemas,
  zodRef,
}: ParsingArgs<z.ZodEnum<never> | z.ZodNativeEnum<never>>): SchemaObject {
  return merge(
    {
      type: typeof Object.values(zodRef._def.values)[0] as 'string' | 'number',
      enum: Object.values(zodRef._def.values),
    },
    ...schemas
  );
}

function parseIntersection({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>>): SchemaObject {
  return merge(
    {
      allOf: [
        generateSchema({
          zodRef: zodRef._def.left,
          useOutput,
        }),
        generateSchema({
          zodRef: zodRef._def.right,
          useOutput,
        }),
      ],
    },
    ...schemas
  );
}

function parseUnion({
  schemas,
  zodRef,
  useOutput,
}: ParsingArgs<z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>>): SchemaObject {
  return merge(
    {
      oneOf: (
        zodRef as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>
      )._def.options.map((schema) =>
        generateSchema({ zodRef: schema, useOutput })
      ),
    },
    ...schemas
  );
}

function parseNever({ schemas }: ParsingArgs<z.ZodNever>): SchemaObject {
  return merge({ readOnly: true }, ...schemas);
}

function catchAllParser({ schemas }: ParsingArgs<ZodTypeAny>): SchemaObject {
  return merge(...schemas);
}

const workerMap = {
  ZodObject: parseObject,
  ZodRecord: parseObject,
  ZodString: parseString,
  ZodNumber: parseNumber,
  ZodBigInt: parseBigInt,
  ZodBoolean: parseBoolean,
  ZodDate: parseDate,
  ZodNull: parseNull,
  ZodOptional: parseOptionalNullable,
  ZodNullable: parseOptionalNullable,
  ZodArray: parseArray,
  ZodLiteral: parseLiteral,
  ZodEnum: parseEnum,
  ZodNativeEnum: parseEnum,
  ZodTransformer: parseTransformation,
  ZodEffects: parseTransformation,
  ZodIntersection: parseIntersection,
  ZodUnion: parseUnion,
  ZodNever: parseNever,
  // TODO Transform the rest to schemas
  ZodUndefined: catchAllParser,
  ZodTuple: catchAllParser,
  ZodMap: catchAllParser,
  ZodFunction: catchAllParser,
  ZodLazy: catchAllParser,
  ZodPromise: catchAllParser,
  ZodAny: catchAllParser,
  ZodUnknown: catchAllParser,
  ZodVoid: catchAllParser,
};
type WorkerKeys = keyof typeof workerMap;

function generateSchema({
  zodRef,
  useOutput,
}: Omit<ParsingArgs<OpenApiZodAny>, 'schemas'>): SchemaObject {
  const { metaOpenApi = {} } = zodRef;
  const schemas = [
    zodRef.isNullable() ? { nullable: true } : {},
    ...(Array.isArray(metaOpenApi) ? metaOpenApi : [metaOpenApi]),
  ];

  try {
    const typeName = zodRef._def.typeName as WorkerKeys;
    if (typeName in workerMap) {
      return workerMap[typeName]({
        zodRef: zodRef as never,
        schemas,
        useOutput,
      });
    }

    return catchAllParser({ zodRef, schemas });
  } catch (err) {
    console.error(err);
    return catchAllParser({ zodRef, schemas });
  }
}