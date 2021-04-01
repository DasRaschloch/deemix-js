class Date {
  constructor(day = "00", month = "00", year = "XXXX"){
    this.day = day
    this.month = month
    this.year = year
    this.fixDayMonth()
  }

  fixDayMonth(){
    if (int(this.month) > 12){
      let temp = this.month
      this.month = this.day
      this.day = temp
    }
  }

  format(template){
    template = template.replaceAll(/D+/g, this.day)
    template = template.replaceAll(/M+/g, this.month)
    template = template.replaceAll(/Y+/g, this.year)
    return template
  }
}

module.exports = {
  Date
}
