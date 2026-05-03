from django.shortcuts import render


def http_500(request):
    raise Exception


def http_404(request):
    return render(request, "404.html")
