using ShinJin.Pop.Api.Data;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true);
if (builder.Environment.IsDevelopment())
{
    builder.Configuration.AddUserSecrets<Program>(optional: true);
}
builder.Configuration.AddEnvironmentVariables();
builder.Configuration.AddCommandLine(args);
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<SqlConnectionFactory>();

var app = builder.Build();
app.UseExceptionHandler();

app.MapGet("/api/health/live", () => Results.Ok(new { status = "ok" }));

app.Run();
